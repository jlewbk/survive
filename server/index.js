const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const gameLogic = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 提供静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// ========== 房间管理 ==========
const rooms = new Map(); // roomCode -> { hostId, players: [{ id, nickname }], game: GameState }

const ROUND_TIMEOUT_MS = 30000; // 30秒出牌超时

// 生成6位房间码（大写字母+数字）
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

// ========== 游戏流程函数 ==========

/**
 * 开始游戏：初始化状态，发牌，开始第一回合
 */
function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  console.log(`[游戏开始] 房间 ${roomCode} 游戏开始！`);

  // 初始化游戏状态
  const gameState = gameLogic.createGameState(room.players);
  room.game = gameState;

  // 广播游戏开始（只包含公开信息）
  io.to(roomCode).emit('game-started', {
    players: gameState.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      handSize: p.cards.length,
    })),
    round: 1,
  });

  // 开始第一回合（startNewRound会发送your-hand）
  startNewRound(roomCode);
}

/**
 * 开始新回合
 */
function startNewRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.game) return;
  const gameState = room.game;

  gameState.round++;
  gameState.phase = 'select-card';
  gameState.playedCards = {};
  gameState.playersPlayed = [];

  console.log(`[回合开始] 房间 ${roomCode} 第 ${gameState.round} 回合`);

  // 广播回合开始
  io.to(roomCode).emit('round-start', {
    round: gameState.round,
  });

  // 给每位存活玩家发送手牌
  for (const player of gameState.players) {
    if (player.eliminated) continue;
    const aliveCards = player.cards.filter((c) => c.hp > 0);
    io.to(player.id).emit('your-hand', {
      cards: aliveCards.map((c) => ({ id: c.id, type: c.type, hp: c.hp, maxHp: c.maxHp })),
    });

    // 如果玩家没有存活卡牌，自动标记淘汰
    if (aliveCards.length === 0 && !player.eliminated) {
      player.eliminated = true;
      io.to(roomCode).emit('player-eliminated', { playerId: player.id, nickname: player.nickname });
      checkGameEnd(roomCode);
    }
  }

  // 设置超时定时器
  if (gameState.roundTimer) {
    clearTimeout(gameState.roundTimer);
  }
  gameState.roundTimer = setTimeout(() => {
    handleRoundTimeout(roomCode);
  }, ROUND_TIMEOUT_MS);
}

/**
 * 处理超时：未出牌的玩家自动出牌
 */
function handleRoundTimeout(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.game) return;
  const gameState = room.game;

  if (gameState.phase !== 'select-card') return;
  if (gameState.playersPlayed.length >= 3) return; // 都已出牌

  console.log(`[超时] 房间 ${roomCode} 出牌超时，自动处理`);

  for (const player of gameState.players) {
    if (player.eliminated) continue;
    if (gameState.playersPlayed.includes(player.id)) continue;

    const autoCard = gameLogic.autoPlayCard(gameState, player.id);
    if (autoCard) {
      gameState.playedCards[player.id] = autoCard.id;
      gameState.playersPlayed.push(player.id);
      io.to(roomCode).emit('card-selected', {
        playerId: player.id,
        remaining: 3 - gameState.playersPlayed.length,
        autoPlayed: true,
      });
      console.log(`[超时] 玩家 ${player.nickname} 自动出牌: ${autoCard.type}`);
    }
  }

  // 结算
  resolveAndBroadcast(roomCode);
}

/**
 * 结算并广播回合结果
 */
function resolveAndBroadcast(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.game) return;
  const gameState = room.game;

  gameState.phase = 'reveal';
  clearTimeout(gameState.roundTimer);

  console.log(`[结算] 房间 ${roomCode} 第 ${gameState.round} 回合开始结算`);

  // 执行战斗结算
  const result = gameLogic.resolveRound(gameState);

  // 广播回合结果
  io.to(roomCode).emit('round-result', {
    round: result.round,
    events: result.events,
    opponents: result.opponents,
    eliminated: result.eliminated,
    gameOver: result.gameOver,
    winnerId: result.winnerId,
  });

  // 给每个玩家单独发送他们的存活卡牌
  for (const player of gameState.players) {
    const playerSurvivors = result.survivors[player.id] || [];
    io.to(player.id).emit('your-survivors', {
      survivors: playerSurvivors.map((c) => ({ id: c.id, type: c.type, hp: c.hp, maxHp: c.maxHp })),
    });
  }

  console.log(`[结算] 房间 ${roomCode} 第 ${gameState.round} 回合结束`);

  // 检查游戏结束
  if (result.gameOver) {
    finalizeGame(roomCode, result.winnerId);
    return;
  }

  // 检查是否需要新回合
  // 检查是否所有玩家都被淘汰（平局）
  const alivePlayers = gameState.players.filter((p) => !p.eliminated);
  if (alivePlayers.length <= 1) {
    finalizeGame(roomCode, alivePlayers.length === 1 ? alivePlayers[0].id : null);
    return;
  }

  // 延迟一下再开始新回合，让玩家看到结果
  setTimeout(() => {
    startNewRound(roomCode);
  }, 2000);
}

/**
 * 结束游戏
 */
function finalizeGame(roomCode, winnerId) {
  const room = rooms.get(roomCode);
  if (!room || !room.game) return;
  const gameState = room.game;

  gameState.phase = 'game-over';

  const winner = winnerId ? gameState.players.find((p) => p.id === winnerId) : null;

  console.log(`[游戏结束] 房间 ${roomCode} 胜者: ${winner ? winner.nickname : '无（平局）'}`);

  io.to(roomCode).emit('game-over', {
    winnerId,
    winnerNickname: winner ? winner.nickname : null,
    standings: gameState.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      eliminated: p.eliminated,
      handSize: p.cards.filter((c) => c.hp > 0).length,
    })),
  });
}

/**
 * 检查游戏是否需要结束
 */
function checkGameEnd(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.game) return;
  const gameState = room.game;

  const alivePlayers = gameState.players.filter((p) => !p.eliminated);
  if (alivePlayers.length <= 1) {
    finalizeGame(roomCode, alivePlayers.length === 1 ? alivePlayers[0].id : null);
    return true;
  }
  return false;
}

// ========== Socket.io 事件处理 ==========

io.on('connection', (socket) => {
  console.log(`[连接] 新客户端连接: ${socket.id}`);

  // --- 创建房间 ---
  socket.on('create-room', ({ nickname }) => {
    console.log(`[创建房间] 玩家 ${nickname} (${socket.id}) 请求创建房间`);

    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, nickname }],
      game: null,
    };
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.emit('room-created', {
      roomCode,
      players: room.players,
    });
    io.to(roomCode).emit('players-update', { players: room.players });

    console.log(`[创建房间] 房间 ${roomCode} 已创建，当前 ${room.players.length}/3 人`);
  });

  // --- 加入房间 ---
  socket.on('join-room', ({ roomCode, nickname }) => {
    const code = roomCode.toUpperCase().trim();
    console.log(`[加入房间] 玩家 ${nickname} (${socket.id}) 请求加入房间 ${code}`);

    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    if (room.game && room.game.phase !== 'game-over') {
      socket.emit('error', { message: '游戏已开始，无法加入' });
      return;
    }
    if (room.players.length >= 3) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    if (room.players.some((p) => p.nickname === nickname)) {
      socket.emit('error', { message: '该昵称已被使用' });
      return;
    }

    room.players.push({ id: socket.id, nickname });
    socket.join(code);
    socket.emit('room-joined', {
      roomCode: code,
      players: room.players,
    });
    io.to(code).emit('players-update', { players: room.players });

    console.log(`[加入房间] 玩家 ${nickname} 加入房间 ${code}，当前 ${room.players.length}/3 人`);

    // 房间满3人，准备开始游戏
    if (room.players.length === 3) {
      console.log(`[游戏就绪] 房间 ${code} 已满，准备开始游戏`);
      io.to(code).emit('room-full', {
        message: '房间已满，游戏即将开始...',
        players: room.players,
      });

      // 3秒倒计时后开始游戏
      setTimeout(() => {
        // 检查房间是否还存在（可能有人中途离开）
        if (rooms.has(code) && rooms.get(code).players.length === 3) {
          startGame(code);
        }
      }, 3000);
    }
  });

  // --- 出牌 ---
  socket.on('play-card', ({ cardId }) => {
    // 找到玩家所在的房间
    let foundRoom = null;
    let roomCode = null;
    for (const [code, room] of rooms.entries()) {
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        foundRoom = room;
        roomCode = code;
        break;
      }
    }

    if (!foundRoom || !foundRoom.game) {
      socket.emit('error', { message: '你不在游戏中' });
      return;
    }

    const gameState = foundRoom.game;

    if (gameState.phase !== 'select-card') {
      socket.emit('error', { message: '当前不是出牌阶段' });
      return;
    }

    if (gameState.playersPlayed.includes(socket.id)) {
      socket.emit('error', { message: '你已经出过牌了' });
      return;
    }

    // 验证卡牌属于该玩家且存活
    const player = gameState.players.find((p) => p.id === socket.id);
    if (!player || player.eliminated) {
      socket.emit('error', { message: '你已被淘汰' });
      return;
    }

    const card = player.cards.find((c) => c.id === cardId);
    if (!card || card.hp <= 0) {
      socket.emit('error', { message: '无效的卡牌' });
      return;
    }

    // 记录出牌
    gameState.playedCards[socket.id] = cardId;
    gameState.playersPlayed.push(socket.id);

    const playerData = foundRoom.players.find((p) => p.id === socket.id);
    console.log(`[出牌] 玩家 ${playerData.nickname} (${socket.id}) 在房间 ${roomCode} 出牌: ${card.type}`);

    // 广播出牌通知（不暴露具体卡牌）
    io.to(roomCode).emit('card-selected', {
      playerId: socket.id,
      remaining: 3 - gameState.playersPlayed.length,
    });

    // 如果3人都已出牌，结算
    if (gameState.playersPlayed.length === 3) {
      io.to(roomCode).emit('all-played', { message: '所有玩家已出牌！' });
      resolveAndBroadcast(roomCode);
    }
  });

  // --- 断线处理 ---
  socket.on('disconnect', () => {
    console.log(`[断线] 客户端断开: ${socket.id}`);

    for (const [code, room] of rooms.entries()) {
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        const removed = room.players.splice(idx, 1)[0];
        console.log(`[断线] 玩家 ${removed.nickname} 从房间 ${code} 中移除`);

        // 如果在游戏中，处理断线
        if (room.game && room.game.phase !== 'game-over') {
          // 标记该玩家淘汰
          const gamePlayer = room.game.players.find((p) => p.id === socket.id);
          if (gamePlayer) {
            gamePlayer.eliminated = true;
            gamePlayer.cards = []; // 清空手牌
          }

          io.to(code).emit('player-forfeited', {
            playerId: socket.id,
            nickname: removed.nickname,
          });

          // 检查游戏是否结束
          const gameOver = checkGameEnd(code);

          // 如果游戏未结束且正在等待该玩家出牌，自动处理
          if (!gameOver && room.game.phase === 'select-card') {
            if (!room.game.playersPlayed.includes(socket.id)) {
              // 自动出牌
              room.game.playersPlayed.push(socket.id);
              io.to(code).emit('card-selected', {
                playerId: socket.id,
                remaining: 3 - room.game.playersPlayed.length,
              });

              if (room.game.playersPlayed.length === 3) {
                resolveAndBroadcast(code);
              }
            }
          }
        }

        if (room.players.length === 0) {
          // 清理定时器
          if (room.game && room.game.roundTimer) {
            clearTimeout(room.game.roundTimer);
          }
          rooms.delete(code);
          console.log(`[断线] 房间 ${code} 已删除（无玩家）`);
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            console.log(`[断线] 房间 ${code} 新房主: ${room.players[0].nickname}`);
          }
          io.to(code).emit('players-update', { players: room.players });
          io.to(code).emit('player-left', {
            message: `玩家 ${removed.nickname} 已离开`,
            players: room.players,
          });
        }
        break;
      }
    }
  });
});

// ========== 启动服务器 ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  🐾 动物卡牌对战服务器已启动`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
