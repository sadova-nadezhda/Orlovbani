(() => {
  "use strict";

  // Helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

  const refreshLenis = () => {
    if (window.lenis && typeof window.lenis.resize === "function") window.lenis.resize();
  };

  const layoutFrozen = () =>
    document.documentElement.classList.contains("is-loading") ||
    document.body.classList.contains("no-scroll");

  let layoutPending = false;

  const refreshLayout = () => {
    if (layoutFrozen()) { layoutPending = true; return; }
    layoutPending = false;
    refreshLenis();
    if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
  };

  const flushLayout = () => {
    if (layoutPending) requestAnimationFrame(refreshLayout);
  };

  let introReady = false;
  const introQueue = [];

  const onIntroReady = (fn) => {
    if (introReady) { fn(); return; }
    introQueue.push(fn);
  };

  const markIntroReady = () => {
    if (introReady) return;
    introReady = true;
    introQueue.splice(0).forEach((fn) => fn());
  };

  const initLayoutWatcher = () => {
    const refresh = debounce(refreshLayout, 150);

    window.addEventListener("load", refresh);
    document.fonts?.ready.then(refresh);

    if (!("ResizeObserver" in window)) return;

    let last = document.body.offsetHeight;
    let busy = false;

    if (typeof ScrollTrigger !== "undefined") {
      ScrollTrigger.addEventListener("refreshInit", () => { busy = true; });
      ScrollTrigger.addEventListener("refresh", () => {
        last = document.body.offsetHeight;
        busy = false;
      });
    }

    new ResizeObserver(() => {
      if (busy) return;
      const height = document.body.offsetHeight;
      if (Math.abs(height - last) < 2) return;
      last = height;
      refresh();
    }).observe(document.body);
  };

  const createScrollLock = (lenis) => {
    const locks = new Set();

    const apply = () => {
      if (locks.size) {
        const scrollbar = window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.setProperty("--scrollbar-width", `${scrollbar}px`);
        document.body.classList.add("no-scroll");
        lenis?.stop?.();
      } else {
        document.body.classList.remove("no-scroll");
        document.documentElement.style.setProperty("--scrollbar-width", "0px");
        lenis?.start?.();
        flushLayout();
      }
    };

    return {
      lock: (key) => {
        if (!key) return;
        locks.add(key);
        apply();
      },
      unlock: (key) => {
        if (!key) return;
        locks.delete(key);
        apply();
      },
      reset: () => {
        locks.clear();
        apply();
      },
      has: (key) => locks.has(key),
    };
  };

  const revealOnce = (section, { onMobile = true } = {}) => {
    if (!section) return;
    if (!onMobile && window.innerWidth <= 767) return;

    section.classList.add("is-intro");
    const reveal = () => section.classList.remove("is-intro");

    if (typeof ScrollTrigger !== "undefined") {
      ScrollTrigger.create({ trigger: section, start: "top 85%", once: true, onEnter: reveal });
      return;
    }

    const onScroll = () => {
      if (section.getBoundingClientRect().top > window.innerHeight * 0.85) return;
      reveal();
      window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  };

  const state = {
    multiplier: 1,
    swipers: {},
  };

  // ======================
  // Lenis
  // ======================
  const initLenis = () => {
    if (typeof Lenis === "undefined") return null;
    const useGsapTicker = typeof gsap !== "undefined";
    const lenis = new Lenis({
      autoRaf: !useGsapTicker,
      anchors: { offset: -Math.round(s(120)) },
    });
    window.lenis = lenis;

    document.documentElement.style.scrollBehavior = "auto";

    if (useGsapTicker) {
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      if (typeof ScrollTrigger !== "undefined") {
        lenis.on("scroll", ScrollTrigger.update);
      }
    }

    return lenis;
  };

  // ======================
  // Multiplier / s()
  // ======================
  const getWidthMultiplier = () => {
    const w = window.innerWidth;
    const minSide = Math.min(window.innerWidth, window.innerHeight);

    if (w <= 767) return minSide / 375;
    if (w <= 1024) return minSide / 768;
    return window.innerWidth / 1440;
  };

  const updateMultiplier = () => {
    state.multiplier = getWidthMultiplier();
  };

  const s = (value) => value * state.multiplier;

  // ======================
  // Header
  // ======================
  const initHeader = () => {
    const header = $(".header");
    if (!header) return;

    const toggle = () => {
      header.classList.toggle("scrolled", window.scrollY > 10);
    };

    toggle();
    window.addEventListener("scroll", toggle, { passive: true });
  };

  // ======================
  // Бургер
  // ======================
  const initBurger = ({ scrollLock }) => {
    const burger = $(".header__burger");
    const nav = $(".header__nav");
    if (!burger || !nav) return null;

    let opened = false;

    const setState = (state) => {
      if (opened === state) return;
      opened = state;

      burger.classList.toggle("is-active", state);
      nav.classList.toggle("is-open", state);
      document.body.classList.toggle("menu-open", state);
      burger.setAttribute("aria-expanded", String(state));

      if (state) scrollLock?.lock?.("menu");
      else scrollLock?.unlock?.("menu");
    };

    burger.addEventListener("click", () => setState(!opened));

    $$(".nav__link, .nav__button", nav).forEach((link) => {
      link.addEventListener("click", () => setState(false));
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setState(false);
    });

    return {
      open: () => setState(true),
      close: () => setState(false),
      toggle: () => setState(!opened),
    };
  };

  // ======================
  // О клубе
  // ======================
  const initAbout = () => {
    const section = $(".about");
    if (!section) return null;

    const tabs = $$(".about__tab", section);
    const items = $$(".about__item", section);
    const videos = $$(".about__video", section);
    if (!tabs.length) return null;

    let active = 0;
    let inView = false;

    // ролик подгружается только когда он стал активным и секция на экране
    const playVideo = (video) => {
      if (!video) return;
      if (!video.getAttribute("src") && video.dataset.src) {
        video.setAttribute("src", video.dataset.src);
      }
      video.play?.()?.catch?.(() => {});
    };

    const setActive = (index) => {
      if (index === active) return;
      active = index;

      tabs.forEach((el, i) => el.classList.toggle("is-active", i === index));
      items.forEach((el, i) => el.classList.toggle("is-active", i === index));
      videos.forEach((el, i) => {
        el.classList.toggle("is-active", i === index);
        if (i === index) {
          if (inView) playVideo(el);
        } else {
          el.pause?.();
        }
      });
    };

    const update = (progress) => {
      const index = Math.floor(progress * tabs.length);
      setActive(Math.min(tabs.length - 1, Math.max(0, index)));
    };

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        ([entry]) => {
          inView = entry.isIntersecting;
          if (inView) playVideo(videos[active]);
          else videos.forEach((el) => el.pause?.());
        },
        { rootMargin: "20% 0px", threshold: 0 }
      ).observe(section);
    } else {
      inView = true;
      playVideo(videos[0]);
    }

    if (typeof ScrollTrigger !== "undefined") {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => update(self.progress),
      });
    } else {
      const onScroll = () => {
        const total = section.offsetHeight - window.innerHeight;
        update(total > 0 ? -section.getBoundingClientRect().top / total : 0);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // клик по пункту прокручивает к соответствующему экрану
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => {
        const total = section.offsetHeight - window.innerHeight;
        const top = section.offsetTop + (total * (i + 0.5)) / tabs.length;
        if (window.lenis?.scrollTo) window.lenis.scrollTo(top);
        else window.scrollTo({ top, behavior: "smooth" });
      });
    });

    return { setActive };
  };

  // ======================
  // Бронирование
  // ======================
  const initBook = () => {
    const section = $(".book");
    if (!section) return null;

    const media = $(".book__media", section);
    const video = $(".book__video", section);
    if (!media) return null;

    revealOnce(section);

    // ролик подгружается только при подходе к секции
    const startVideo = () => {
      if (!video) return;
      if (!video.getAttribute("src") && video.dataset.src) {
        video.setAttribute("src", video.dataset.src);
      }
      video.play?.()?.catch?.(() => {});
    };

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) startVideo();
          else video?.pause?.();
        },
        { rootMargin: "20% 0px", threshold: 0 }
      ).observe(section);

    } else {
      startVideo();
    }

    return null;
  };

  // ======================
  // Галерея
  // ======================
  const initGallery = () => {
    const section = $(".gallery");
    const slider = $(".gallery__slider", section || document);
    if (!section || !slider) return null;

    let swiper = null;

    const sync = () => {
      const mobile = window.innerWidth <= 767;

      if (mobile && !swiper && typeof Swiper !== "undefined") {
        swiper = new Swiper(slider, {
          slidesPerView: 1.15,
          spaceBetween: s(12),
          grabCursor: true,
        });
      } else if (!mobile && swiper) {
        swiper.destroy(true, true);
        swiper = null;
      }
    };

    sync();

    revealOnce(section, { onMobile: false });

    return { update: sync };
  };

  // ======================
  // Услуги
  // ======================
  const initServices = () => {
    // анимация появления нужна только блоку на главной, на странице услуг её нет
    revealOnce($(".home-services"));
  };

  // ======================
  // Новости
  // ======================
  const initNews = () => {
    const slider = $(".news__slider");
    if (!slider || typeof Swiper === "undefined") return null;

    state.swipers.news = new Swiper(slider, {
      slidesPerView: 1.25,
      spaceBetween: s(12),
      grabCursor: true,
      breakpoints: {
        768: { slidesPerView: 2 },
        1025: { slidesPerView: 4 },
      },
    });

    return null;
  };

  // ======================
  // Отзывы
  // ======================
  const initReviews = () => {
    const slider = $(".reviews__slider");
    if (!slider || typeof Swiper === "undefined") return null;

    state.swipers.reviews = new Swiper(slider, {
      slidesPerView: 1.15,
      spaceBetween: s(12),
      grabCursor: true,
      breakpoints: {
        768: { slidesPerView: 2 },
        1025: { slidesPerView: 3 },
      },
    });

    return null;
  };

  // ======================
  // Контакты
  // ======================
  const initFeedback = () => {
    const section = $(".feedback");
    const video = section ? $(".feedback__video", section) : null;
    if (!section || !video) return null;

    // ролик подгружается только при подходе к секции
    const startVideo = () => {
      if (!video.getAttribute("src") && video.dataset.src) {
        video.setAttribute("src", video.dataset.src);
      }
      video.play?.()?.catch?.(() => {});
    };

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) startVideo();
          else video.pause?.();
        },
        { rootMargin: "20% 0px", threshold: 0 }
      ).observe(section);
    } else {
      startVideo();
    }

    return null;
  };

  // ======================
  // Промо-карточка в hero
  // ======================
  const initHeroCard = () => {
    const card = $(".hero__card");
    if (!card) return;

    $("[data-card-close]", card)?.addEventListener("click", () => {
      card.classList.add("is-hidden");
      refreshLayout();
    });
  };

  // ======================
  // Интро
  // ======================
  const initIntro = () => {
    const start = () => {
      document.documentElement.classList.remove("is-loading");
      markIntroReady();
      refreshLayout();
    };

    if (document.readyState === "complete") requestAnimationFrame(start);
    else window.addEventListener("load", () => requestAnimationFrame(start), { once: true });
  };

  const initHeroIntro = () => {
    if (!$(".hero")) return;

    onIntroReady(() => {
      if (typeof gsap === "undefined") return;

      const tl = gsap.timeline({
        defaults: { ease: "power3.out", duration: 1, clearProps: "all" },
      });

      tl.fromTo(".header__container > *", { y: s(-20), opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1 })
        .fromTo(".hero__title", { y: s(40), opacity: 0 }, { y: 0, opacity: 1 }, "-=0.8")
        .fromTo(".hero__desc", { y: s(30), opacity: 0 }, { y: 0, opacity: 1 }, "-=0.75")
        .fromTo(".hero__button", { y: s(20), opacity: 0 }, { y: 0, opacity: 1 }, "-=0.75")
        .fromTo(".hero__bottom > *", { y: s(20), opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1 }, "-=0.7");

      setTimeout(() => {
        if (tl.progress() < 1) tl.progress(1);
      }, 4000);
    });
  };

  // ======================
  // Переключатель языков
  // ======================
  const initLang = () => {
    const links = $$("[data-lang]");
    if (!links.length) return null;

    const bar = $(".lang");
    const thumb = bar ? $(".lang__thumb", bar) : null;
    const current = $$(".header__lang-current");

    const updateThumb = () => {
      if (!bar || !thumb) return;

      const active = $(".lang__item.is-active", bar);

      if (!active || !active.offsetWidth) return;

      thumb.style.setProperty("--lang-thumb-w", active.offsetWidth + "px");
      thumb.style.setProperty("--lang-thumb-x", active.offsetLeft + "px");

      if (!bar.classList.contains("is-ready")) {
        void thumb.offsetWidth;
        bar.classList.add("is-ready");
      }
    };

    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const lang = link.dataset.lang;
        if (!lang) return;

        links.forEach((l) => l.classList.toggle("is-active", l.dataset.lang === lang));
        current.forEach((el) => (el.textContent = lang));
        updateThumb();
      });
    });

    if ("ResizeObserver" in window && bar) new ResizeObserver(updateThumb).observe(bar);
    document.fonts?.ready.then(updateThumb);
    updateThumb();

    return { update: updateThumb };
  };

  // ======================
  // Swipers
  // ======================
  const initSwipers = () => {
    if (typeof Swiper === "undefined") return;

    const hero = $(".hero__slider");
    if (hero) {
      state.swipers.hero = new Swiper(hero, {
        slidesPerView: 1,
        loop: true,
        speed: 1000,
        effect: "fade",
        fadeEffect: { crossFade: true },
        autoplay: {
          delay: 6000,
          disableOnInteraction: false,
        },
        pagination: {
          el: ".hero__pagination",
          clickable: true,
        },
      });
    }

    const teams = $(".teams__swiper");
    if (teams) {
      state.swipers.teams = new Swiper(teams, {
        slidesPerView: 1.3,
        spaceBetween: s(16),
        grabCursor: true,
        pagination: {
          el: ".teams__counter",
          type: "fraction",
        },
        navigation: {
          prevEl: ".teams__arrow--prev",
          nextEl: ".teams__arrow--next",
        },
        breakpoints: {
          768: {
            slidesPerView: 2.5,
          },
          1025: {
            slidesPerView: 4,
            spaceBetween: s(24),
          },
        },
      });
    }

  };

  // ======================
  // Новости и акции — фильтр и «показать ещё»
  // ======================
  const initNewsPage = () => {
    const section = $(".news-page");
    if (!section) return null;

    const cards = $$("[data-category]", section);
    if (!cards.length) return null;

    const STEP = 8;

    const tabs = $$("[data-filter]", section);
    const more = $("[data-news-more]", section);

    let filter = "all";
    let limit = STEP;

    const matched = () => cards.filter((card) => filter === "all" || card.dataset.category === filter);

    const render = () => {
      const list = matched();

      cards.forEach((card) => { card.hidden = true; });
      list.slice(0, limit).forEach((card) => { card.hidden = false; });

      if (more) more.hidden = list.length <= limit;

      refreshLayout();
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        filter = tab.dataset.filter || "all";
        limit = STEP;
        tabs.forEach((el) => el.classList.toggle("is-active", el === tab));
        render();
      });
    });

    more?.addEventListener("click", () => {
      limit += STEP;
      render();
    });

    render();

    return { render };
  };

  // ролик подгружается и играет только пока он на экране
  const initLazyVideo = (video) => {
    if (!video) return;

    const start = () => {
      if (!video.getAttribute("src") && video.dataset.src) {
        video.setAttribute("src", video.dataset.src);
      }
      video.play?.()?.catch?.(() => {});
    };

    if (!("IntersectionObserver" in window)) {
      start();
      return;
    }

    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
        else video.pause?.();
      },
      { rootMargin: "20% 0px", threshold: 0 }
    ).observe(video);
  };

  // ======================
  // Расписание парений
  // ======================
  const initSchedule = () => {
    initLazyVideo($(".schedule__video"));
    return null;
  };

  // ======================
  // Фильтр по табам — прячет элементы, у которых значение не совпало
  // ======================
  const initTabsFilter = (section, selector, key) => {
    if (!section) return null;

    const items = $$(selector, section);
    const tabs = $$("[data-filter]", section);
    if (!items.length || !tabs.length) return null;

    const render = (filter) => {
      items.forEach((item) => {
        item.hidden = filter !== "all" && item.dataset[key] !== filter;
      });

      refreshLayout();
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((el) => el.classList.toggle("is-active", el === tab));
        render(tab.dataset.filter || "all");
      });
    });

    render("all");

    return { render };
  };

  // товары для бани фильтруются целыми разделами, SPA-услуги — карточками
  const initProducts = () => initTabsFilter($(".products"), "[data-group]", "group");

  const initServicesPage = () => initTabsFilter($(".services-page"), "[data-category]", "category");

  // ======================
  // Бар и кухня
  // ======================
  const initMenu = () => {
    const section = $(".menu");
    if (!section) return null;

    const gallery = $(".menu__gallery", section);
    if (gallery && typeof Swiper !== "undefined") {
      state.swipers.menu = new Swiper(gallery, {
        slidesPerView: "auto",
        spaceBetween: s(8),
        grabCursor: true,
        centeredSlides: true,
        loop: true,
      });
    }

    // разделы не фильтруются, ссылки просто прокручивают к нужному блоку
    const links = $$("[data-anchor]", section);
    if (!links.length) return null;

    // «Все» ведёт на начало списка и остаётся активной, пока не дошли до первого раздела
    const groups = links
      .map((link) => ({ link, target: document.getElementById(link.dataset.anchor) }))
      .filter((item) => item.target?.classList.contains("menu__group"));

    const sync = () => {
      const offset = s(140);
      let current = links[0];

      groups.forEach(({ link, target }) => {
        if (target.getBoundingClientRect().top <= offset) current = link;
      });

      links.forEach((link) => link.classList.toggle("is-active", link === current));
    };

    window.addEventListener("scroll", sync, { passive: true });
    sync();

    return { sync };
  };

  // ======================
  // Поля выбора даты и времени
  // ======================
  const initFields = () => {
    const fields = $$("[data-field]");
    if (!fields.length) return null;

    // список «закрывашек» — открытым может быть только одно поле
    const closers = [];
    const closeAll = (except) => closers.forEach((close) => close !== except && close());

    $$("[data-datepicker]").forEach((input) => {
      if (typeof flatpickr === "undefined") return;

      const field = input.closest("[data-field]");
      const control = input.closest("[data-field-control]");
      if (!field || !control) return;

      const picker = flatpickr(input, {
        locale: flatpickr.l10ns?.ru ?? "default",
        dateFormat: "d.m.Y",
        defaultDate: input.value || "today",
        monthSelectorType: "static",
        clickOpens: false,
        disableMobile: true,
        static: true,
        onOpen: () => field.classList.add("is-open"),
        onClose: () => field.classList.remove("is-open"),
      });

      const close = () => picker.close();
      closers.push(close);

      control.addEventListener("click", (e) => {
        // клики внутри самого календаря обрабатывает flatpickr
        if (e.target.closest(".flatpickr-calendar")) {
          e.stopPropagation();
          return;
        }

        e.stopPropagation();

        if (picker.isOpen) {
          picker.close();
          return;
        }

        closeAll(close);
        picker.open();
      });
    });

    $$("[data-select]").forEach((control) => {
      const field = control.closest("[data-field]");
      const value = $("[data-select-value]", control);
      const input = $("[data-select-input]", control);
      const options = $$("[data-select-option]", control);
      if (!field || !value) return;

      const close = () => field.classList.remove("is-open");
      closers.push(close);

      control.addEventListener("click", (e) => {
        e.stopPropagation();

        const option = e.target.closest("[data-select-option]");

        if (option) {
          options.forEach((el) => el.classList.toggle("is-active", el === option));
          value.textContent = option.textContent.trim();
          if (input) input.value = option.dataset.selectOption ?? "";
          close();
          return;
        }

        if (field.classList.contains("is-open")) {
          close();
          return;
        }

        closeAll(close);
        field.classList.add("is-open");
      });
    });

    document.addEventListener("click", () => closeAll());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });

    return { close: () => closeAll() };
  };

  // ======================
  // Билеты / корзина бронирования
  // ======================
  const initTickets = ({ scrollLock }) => {
    const section = $(".tickets");
    if (!section) return null;

    const cards = $$("[data-ticket]", section);
    if (!cards.length) return null;

    const bar = $("[data-booking-bar]");
    const barPrice = bar ? $("[data-booking-price]", bar) : null;
    const barOld = bar ? $("[data-booking-old]", bar) : null;

    const drawer = $("[data-drawer]");
    let drawerCard = null;

    const price = (value) => `${Math.round(value).toLocaleString("ru-RU").replace(/[\u00A0\u202F]/g, " ")} ₸`;
    const qtyOf = (card) => Number(card.dataset.qty || 0);

    const renderCard = (card) => {
      const qty = qtyOf(card);

      $("[data-ticket-add]", card).hidden = qty > 0;

      const counter = $("[data-ticket-counter]", card);
      counter.hidden = qty === 0;
      $("[data-ticket-value]", counter).value = qty || 1;
    };

    const renderBar = () => {
      if (!bar) return;

      const total = cards.reduce((sum, card) => sum + qtyOf(card) * Number(card.dataset.price || 0), 0);
      const old = cards.reduce((sum, card) => sum + qtyOf(card) * Number(card.dataset.oldPrice || 0), 0);

      if (barPrice) barPrice.textContent = price(total);
      if (barOld) {
        barOld.textContent = price(old);
        barOld.hidden = old <= total;
      }

      const visible = total > 0;
      bar.classList.toggle("is-visible", visible);
      document.body.classList.toggle("is-bar", visible);
    };

    const setQty = (card, value) => {
      card.dataset.qty = String(Math.max(0, Math.min(20, value)));
      renderCard(card);
      renderBar();
    };

    cards.forEach((card) => {
      card.dataset.qty = card.dataset.qty || "0";
      renderCard(card);

      $("[data-ticket-add]", card).addEventListener("click", () => setQty(card, 1));
      $("[data-ticket-plus]", card).addEventListener("click", () => setQty(card, qtyOf(card) + 1));
      $("[data-ticket-minus]", card).addEventListener("click", () => setQty(card, qtyOf(card) - 1));
      $("[data-ticket-more]", card).addEventListener("click", () => openDrawer(card));
    });

    // ---- Панель с описанием билета ----
    const fillDrawer = (card) => {
      const image = $("[data-drawer-image]", drawer);
      const cardImage = $("[data-ticket-image]", card);
      if (image && cardImage) {
        image.src = cardImage.src;
        image.alt = cardImage.alt;
      }

      const set = (sel, value) => {
        const el = $(sel, drawer);
        if (el) el.textContent = value;
      };

      set("[data-drawer-title]", $("[data-ticket-title]", card)?.textContent.trim() ?? "");
      set("[data-drawer-note]", $("[data-ticket-note]", card)?.textContent.trim() ?? "");
      set("[data-drawer-desc]", $("[data-ticket-desc]", card)?.textContent.trim() ?? "");
      set("[data-drawer-price]", price(Number(card.dataset.price || 0)));
      set("[data-drawer-old]", price(Number(card.dataset.oldPrice || 0)));
    };

    const openDrawer = (card) => {
      if (!drawer) return;

      drawerCard = card;
      fillDrawer(card);

      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      scrollLock?.lock?.("drawer");
    };

    const closeDrawer = () => {
      if (!drawer) return;

      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      scrollLock?.unlock?.("drawer");
      drawerCard = null;
    };

    if (drawer) {
      $$("[data-drawer-close]", drawer).forEach((el) => el.addEventListener("click", closeDrawer));

      $("[data-drawer-add]", drawer)?.addEventListener("click", () => {
        if (drawerCard) setQty(drawerCard, qtyOf(drawerCard) + 1);
        closeDrawer();
      });

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDrawer();
      });
    }

    renderBar();

    return { open: openDrawer, close: closeDrawer };
  };

  // ======================
  // Modals
  // ======================
  const initModals = ({ scrollLock, closeMobileMenu }) => {
    const wrapper = $(".modals");
    if (!wrapper) return;

    const modals = $$(".modal", wrapper);
    const getModalByType = (type) => wrapper.querySelector(`.modal[data-type="${type}"]`);

    const showWrapper = () => {
      wrapper.style.opacity = 1;
      wrapper.style.pointerEvents = "auto";
      scrollLock?.lock?.("modal");
    };

    const hideWrapper = () => {
      wrapper.style.opacity = 0;
      wrapper.style.pointerEvents = "none";
      scrollLock?.unlock?.("modal");
    };

    const fillFromCard = (modal, btn) => {
      const card = btn.closest("[data-modal-source]");
      if (!modal || !card) return;

      const modalImg = $(".modal__img img", modal);
      const cardImg = $("[data-modal-img]", card);
      if (modalImg && cardImg) {
        modalImg.src = cardImg.src;
        modalImg.alt = cardImg.alt;
      }

      const title = $(".modal__title", modal);
      if (title) title.textContent = $("[data-modal-title]", card)?.textContent.trim() ?? "";

      const text = $(".modal__text", modal);
      if (text) text.innerHTML = $("[data-modal-text]", card)?.innerHTML ?? "";
    };

    const fillTopic = (modal, btn) => {
      if (!modal) return;

      const source = btn.closest(".modal");
      const topic = source ? $(".modal__title", source)?.textContent.trim() ?? "" : "";
      const label = source?.dataset.topicLabel ?? "";

      $$("[data-modal-topic]", modal).forEach((el) => {
        if (el.tagName === "INPUT") {
          el.value = topic && label ? `${label}: ${topic}` : topic;
          return;
        }
        el.textContent = topic;
        el.hidden = !topic;
        if (label) {
          el.dataset.label = label;
        } else {
          delete el.dataset.label;
        }
      });
    };

    const openModal = (type) => {
      closeMobileMenu?.();

      modals.forEach((m) => {
        m.classList.remove("open");
        m.style.removeProperty("transform");
      });

      const modal = getModalByType(type);
      if (!modal) return;

      modal.classList.add("open");
      showWrapper();

      if (window.gsap) {
        window.gsap.fromTo(modal, { y: -100 }, { y: 0, duration: 0.5, ease: "power3.out" });
      }
    };

    const closeCurrentModal = () => {
      const current = modals.find((m) => m.classList.contains("open"));

      const finish = () => {
        if (current) current.classList.remove("open");
        hideWrapper();
      };

      if (current && window.gsap) {
        window.gsap.to(current, {
          y: -100,
          duration: 0.4,
          ease: "power3.in",
          onComplete: () => {
            current.style.removeProperty("transform");
            finish();
          },
        });
      } else {
        finish();
      }
    };

    $$(".modal-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const type = btn.dataset.type;
        if (!type) return;

        const modal = getModalByType(type);
        fillFromCard(modal, btn);
        fillTopic(modal, btn);
        openModal(type);
      });
    });

    wrapper.addEventListener("click", (e) => {
      if (
        e.target === wrapper ||
        e.target.closest(".modal__close") ||
        e.target.closest("[data-modal-close]")
      ) closeCurrentModal();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && wrapper.style.pointerEvents === "auto") closeCurrentModal();
    });

    return { open: openModal, close: closeCurrentModal };
  };

  // ======================
  // Формы
  // ======================
  const initForms = ({ modals }) => {
    $$(".form").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        // здесь будет реальная отправка, пока показываем окно «заявка отправлена»
        form.reset();
      });
    });
  };

  // ======================
  // Phone mask
  // ======================
  const initPhoneMask = () => {
    const inputs = $$('input[type="tel"]');
    if (!inputs.length) return;

    const format = (value, matrix) => {
      const prefix = matrix.replace(/\D/g, "");
      const slots = (matrix.match(/[_\d]/g) || []).length;
      const free = slots - prefix.length;
      const head = matrix.slice(0, matrix.indexOf("_"));

      let body;
      if (value.startsWith(head)) {
        body = value.slice(head.length).replace(/\D/g, "");
      } else {
        body = value.replace(/\D/g, "");
        if (body.length > free && /^[78]/.test(body)) body = body.slice(1);
      }
      body = body.slice(0, free);
      if (!body) return "";

      const digits = prefix + body;
      let res = "";
      let i = 0;
      for (const ch of matrix) {
        if (/[_\d]/.test(ch)) {
          if (i >= digits.length) break;
          res += digits[i++];
        } else {
          res += ch;
        }
      }
      return res.replace(/\D+$/, "");
    };

    inputs.forEach((input) => {
      const matrix = input.dataset.mask || "+7 (___) ___ ____";
      const prefix = matrix.replace(/\D/g, "");

      input.addEventListener("input", (e) => {
        const entered = input.value.replace(/\D/g, "");
        if (e.inputType?.startsWith("delete") && entered.length <= prefix.length) {
          input.value = "";
          return;
        }
        input.value = format(input.value, matrix);
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    updateMultiplier();
    const lenis = initLenis();

    const scrollLock = createScrollLock(lenis);


    const safe = (name, fn) => {
      try {
        return fn();
      } catch (e) {
        console.error(`[init] ${name}`, e);
        return null;
      }
    };

    safe("header", initHeader);
    const mobileMenu = safe("burger", () => initBurger({ scrollLock }));
    const lang = safe("lang", initLang);
    safe("swipers", initSwipers);
    safe("heroCard", initHeroCard);
    safe("about", initAbout);
    safe("book", initBook);
    const gallery = safe("gallery", initGallery);
    safe("services", initServices);
    safe("news", initNews);
    safe("reviews", initReviews);
    safe("feedback", initFeedback);
    safe("newsPage", initNewsPage);
    safe("servicesPage", initServicesPage);
    safe("menu", initMenu);
    safe("products", initProducts);
    safe("schedule", initSchedule);
    safe("fields", initFields);
    safe("tickets", () => initTickets({ scrollLock }));
    safe("phoneMask", initPhoneMask);
    const modals = safe("modals", () => initModals({ scrollLock, closeMobileMenu: mobileMenu?.close }));
    safe("forms", () => initForms({ modals }));

    safe("heroIntro", initHeroIntro);
    initIntro();


    refreshLayout();
    initLayoutWatcher();

    window.addEventListener("resize", debounce(() => {
      updateMultiplier();
      lang?.update?.();
      gallery?.update?.();
      refreshLayout();
    }, 150));
  });
})();
