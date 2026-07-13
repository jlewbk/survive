/* ============================================
   林夕摄影 | LIN XI PHOTOGRAPHY
   交互脚本
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ========== DOM 元素引用 ==========
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('.nav-link');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const galleryItems = document.querySelectorAll('.gallery-item');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCaption = document.getElementById('lightboxCaption');
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const testimonialCards = document.querySelectorAll('.testimonial-card');
    const testimonialDots = document.querySelectorAll('.dot');
    const contactForm = document.getElementById('contactForm');
    const newsletterForm = document.getElementById('newsletterForm');
    const statNumbers = document.querySelectorAll('.stat-number');
    const fadeElements = document.querySelectorAll('.fade-in');

    let currentGalleryIndex = 0;
    let currentFilter = 'all';
    let testimonialIndex = 0;
    let testimonialInterval;

    // ========== 导航栏滚动效果 ==========
    function updateNavbar() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }

    window.addEventListener('scroll', updateNavbar);
    updateNavbar(); // 初始检查

    // ========== 移动端菜单 ==========
    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navMenu.classList.toggle('open');
    });

    // 点击导航链接关闭菜单
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            navMenu.classList.remove('open');
        });
    });

    // ========== 导航激活状态 ==========
    const sections = document.querySelectorAll('section[id]');

    function updateActiveLink() {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    }

    window.addEventListener('scroll', updateActiveLink);

    // ========== 作品集筛选 ==========
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // 更新按钮状态
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentFilter = btn.dataset.filter;

            // 筛选动画
            galleryItems.forEach(item => {
                const category = item.dataset.category;
                if (currentFilter === 'all' || category === currentFilter) {
                    item.style.display = 'block';
                    item.style.animation = 'fadeIn 0.4s ease-out forwards';
                } else {
                    item.style.display = 'none';
                }
            });

            // 更新灯箱索引列表
            updateLightboxItems();
        });
    });

    // ========== 灯箱功能 ==========
    function getVisibleGalleryItems() {
        return Array.from(galleryItems).filter(item =>
            item.style.display !== 'none'
        );
    }

    function updateLightboxItems() {
        // 在打开灯箱时动态获取可见项
    }

    function openLightbox(index) {
        const visibleItems = getVisibleGalleryItems();
        const item = visibleItems[index];
        if (!item) return;

        currentGalleryIndex = index;
        const img = item.querySelector('img');
        const title = item.querySelector('h3');
        const category = item.querySelector('p');

        lightboxImg.src = img.src;
        lightboxImg.alt = img.alt;
        lightboxCaption.textContent = title ? `${title.textContent} — ${category.textContent}` : '';

        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('open');
        document.body.style.overflow = '';
    }

    function navigateLightbox(direction) {
        const visibleItems = getVisibleGalleryItems();
        if (visibleItems.length === 0) return;

        currentGalleryIndex = (currentGalleryIndex + direction + visibleItems.length) % visibleItems.length;
        const item = visibleItems[currentGalleryIndex];
        const img = item.querySelector('img');
        const title = item.querySelector('h3');
        const category = item.querySelector('p');

        lightboxImg.src = img.src;
        lightboxImg.alt = img.alt;
        lightboxCaption.textContent = title ? `${title.textContent} — ${category.textContent}` : '';
    }

    galleryItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            const visibleItems = getVisibleGalleryItems();
            const visibleIndex = visibleItems.indexOf(item);
            openLightbox(visibleIndex >= 0 ? visibleIndex : 0);
        });
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
    lightboxNext.addEventListener('click', () => navigateLightbox(1));

    // 键盘导航
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('open')) return;

        switch (e.key) {
            case 'Escape':
                closeLightbox();
                break;
            case 'ArrowLeft':
                navigateLightbox(-1);
                break;
            case 'ArrowRight':
                navigateLightbox(1);
                break;
        }
    });

    // 点击背景关闭
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    // ========== 客户评价轮播 ==========
    function showTestimonial(index) {
        testimonialCards.forEach(card => card.classList.remove('active'));
        testimonialDots.forEach(dot => dot.classList.remove('active'));

        testimonialCards[index].classList.add('active');
        testimonialDots[index].classList.add('active');
        testimonialIndex = index;
    }

    testimonialDots.forEach(dot => {
        dot.addEventListener('click', () => {
            const index = parseInt(dot.dataset.index);
            showTestimonial(index);
            resetTestimonialInterval();
        });
    });

    // 自动轮播
    function startTestimonialInterval() {
        testimonialInterval = setInterval(() => {
            testimonialIndex = (testimonialIndex + 1) % testimonialCards.length;
            showTestimonial(testimonialIndex);
        }, 5000);
    }

    function resetTestimonialInterval() {
        clearInterval(testimonialInterval);
        startTestimonialInterval();
    }

    startTestimonialInterval();

    // ========== 数字递增动画 ==========
    function animateNumbers() {
        statNumbers.forEach(stat => {
            const target = parseInt(stat.dataset.count);
            const duration = 2000;
            const startTime = performance.now();

            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // easeOutExpo
                const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
                const current = Math.floor(eased * target);

                stat.textContent = current;

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    stat.textContent = target;
                }
            }

            requestAnimationFrame(update);
        });
    }

    // ========== 滚动渐入动画 ==========
    function setupScrollAnimations() {
        const observerOptions = {
            root: null,
            rootMargin: '0px 0px -50px 0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');

                    // 如果是关于我区域，触发数字动画
                    if (entry.target.closest('.about-section') && !entry.target.dataset.animated) {
                        entry.target.dataset.animated = 'true';
                        animateNumbers();
                    }

                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // 为关键区块添加渐入效果
        const animatableSections = document.querySelectorAll(`
            .section-header,
            .service-card,
            .gallery-item,
            .about-image,
            .about-content,
            .contact-info,
            .contact-form-wrapper,
            .testimonial-card,
            .footer-links,
            .footer-newsletter,
            .footer-brand
        `);

        animatableSections.forEach(el => {
            el.classList.add('fade-in');
        });

        document.querySelectorAll('.fade-in').forEach(el => {
            observer.observe(el);
        });
    }

    setupScrollAnimations();

    // ========== 联系表单处理 ==========
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const formData = new FormData(contactForm);
        const data = Object.fromEntries(formData.entries());

        // 模拟提交
        const submitBtn = contactForm.querySelector('.btn-submit');
        const originalHTML = submitBtn.innerHTML;

        submitBtn.innerHTML = '<span>发送中...</span>';
        submitBtn.disabled = true;

        setTimeout(() => {
            submitBtn.innerHTML = '<span>✓ 发送成功！</span>';
            submitBtn.style.background = '#4CAF50';
            submitBtn.style.borderColor = '#4CAF50';

            console.log('表单数据:', data);

            // 恢复按钮
            setTimeout(() => {
                submitBtn.innerHTML = originalHTML;
                submitBtn.style.background = '';
                submitBtn.style.borderColor = '';
                submitBtn.disabled = false;
                contactForm.reset();
            }, 2500);
        }, 1500);
    });

    // ========== 订阅表单处理 ==========
    newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const email = newsletterForm.querySelector('input').value;
        const button = newsletterForm.querySelector('button');
        const originalText = button.textContent;

        button.textContent = '已订阅 ✓';
        button.style.background = '#4CAF50';

        console.log('订阅邮箱:', email);

        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
            newsletterForm.reset();
        }, 2500);
    });

    // ========== 平滑滚动 (Safari fallback) ==========
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                const navHeight = navbar.offsetHeight;
                const targetPosition = target.offsetTop - navHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

});
