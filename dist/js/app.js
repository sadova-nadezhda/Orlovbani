(() => {
  "use strict";

  // ============================================================
  // Утилиты
  // ============================================================

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const debounce = (fn, ms) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  // В приватном режиме и при заблокированных куках обращение к storage бросает
  // исключение — оборачиваем, чтобы это не роняло инициализацию.
  const safeStorage = (getStore) => ({
    get(key) {
      try {
        return getStore().getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        getStore().setItem(key, value);
      } catch (e) {
        // не запомнили — не страшно
      }
    },
  });

  const localStore = safeStorage(() => localStorage);
  const sessionStore = safeStorage(() => sessionStorage);

  // Одноразовый сигнал: подписчик, добавленный после срабатывания, вызывается сразу.
  const createSignal = () => {
    let fired = false;
    const queue = [];

    return {
      then: (fn) => (fired ? fn() : queue.push(fn)),
      fire: () => {
        if (fired) return;
        fired = true;
        queue.splice(0).forEach((fn) => fn());
      },
    };
  };

  const escapeHandlers = new Set();
  const onEscape = (fn) => escapeHandlers.add(fn);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") escapeHandlers.forEach((fn) => fn());
  });

  // Ролик подгружается и играет, только пока он на экране.
  const lazyVideo = (video, root = video) => {
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
      ([entry]) => (entry.isIntersecting ? start() : video.pause?.()),
      { rootMargin: "20% 0px", threshold: 0 }
    ).observe(root);
  };

  // Секция появляется один раз при подходе к ней.
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

  // Прокрутка к точке — через Lenis, если он есть.
  const scrollToY = (top) => {
    if (window.lenis?.scrollTo) window.lenis.scrollTo(top);
    else window.scrollTo({ top, behavior: "smooth" });
  };

  // ============================================================
  // Общее состояние и пересчёт раскладки
  // ============================================================

  const state = {
    multiplier: 1,
    swipers: {},
  };

  const getWidthMultiplier = () => {
    const width = window.innerWidth;
    const minSide = Math.min(window.innerWidth, window.innerHeight);

    if (width <= 767) return minSide / 375;
    if (width <= 1024) return minSide / 768;
    return width / 1440;
  };

  const updateMultiplier = () => {
    state.multiplier = getWidthMultiplier();
  };

  const s = (value) => value * state.multiplier;

  const introSignal = createSignal();
  const preloaderSignal = createSignal();

  const refreshLenis = () => {
    if (typeof window.lenis?.resize === "function") window.lenis.resize();
  };

  const layoutFrozen = () =>
    document.documentElement.classList.contains("is-loading") ||
    document.body.classList.contains("no-scroll");

  let layoutPending = false;

  const refreshLayout = () => {
    if (layoutFrozen()) {
      layoutPending = true;
      return;
    }

    layoutPending = false;
    refreshLenis();
    if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
  };

  const flushLayout = () => {
    if (layoutPending) requestAnimationFrame(refreshLayout);
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
        return;
      }

      document.body.classList.remove("no-scroll");
      document.documentElement.style.setProperty("--scrollbar-width", "0px");
      lenis?.start?.();
      flushLayout();
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

  // ============================================================
  // Внешние библиотеки
  // ============================================================

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
      if (typeof ScrollTrigger !== "undefined") lenis.on("scroll", ScrollTrigger.update);
    }

    return lenis;
  };

  const makeSwiper = (name, target, options) => {
    if (!target || typeof Swiper === "undefined") return null;

    state.swipers[name] = new Swiper(target, options);
    return state.swipers[name];
  };

  const initFancybox = () => {
    if (typeof Fancybox === "undefined") return;
    Fancybox.bind("[data-fancybox]", {});
  };

  // ============================================================
  // Шапка и навигация
  // ============================================================

  const initHeader = () => {
    const header = $(".header");
    if (!header) return;

    const toggle = () => header.classList.toggle("scrolled", window.scrollY > 10);

    toggle();
    window.addEventListener("scroll", toggle, { passive: true });
  };

  const initBurger = ({ scrollLock }) => {
    const burger = $(".header__burger");
    const nav = $(".header__nav");
    if (!burger || !nav) return null;

    let opened = false;

    const setState = (next) => {
      if (opened === next) return;
      opened = next;

      burger.classList.toggle("is-active", next);
      nav.classList.toggle("is-open", next);
      document.body.classList.toggle("menu-open", next);
      burger.setAttribute("aria-expanded", String(next));

      if (next) scrollLock?.lock?.("menu");
      else scrollLock?.unlock?.("menu");
    };

    burger.addEventListener("click", () => setState(!opened));

    $$(".nav__link, .nav__button", nav).forEach((link) => {
      link.addEventListener("click", () => setState(false));
    });

    onEscape(() => setState(false));

    return {
      open: () => setState(true),
      close: () => setState(false),
      toggle: () => setState(!opened),
    };
  };

  const initLang = () => {
    const links = $$("[data-lang]");
    if (!links.length) return null;

    const bar = $(".lang");
    const thumb = bar ? $(".lang__thumb", bar) : null;
    const current = $$(".header__lang-current");

    const moveThumb = (item) => {
      if (!bar || !thumb || !item || !item.offsetWidth) return;

      thumb.style.setProperty("--lang-thumb-w", `${item.offsetWidth}px`);
      thumb.style.setProperty("--lang-thumb-x", `${item.offsetLeft}px`);

      if (!bar.classList.contains("is-ready")) {
        void thumb.offsetWidth;
        bar.classList.add("is-ready");
      }
    };

    const updateThumb = () => {
      if (bar) moveThumb($(".lang__item.is-active", bar));
    };

    links.forEach((link) => {
      link.addEventListener("mouseenter", () => moveThumb(link));

      link.addEventListener("click", (e) => {
        e.preventDefault();

        const lang = link.dataset.lang;
        if (!lang) return;

        links.forEach((el) => el.classList.toggle("is-active", el.dataset.lang === lang));
        current.forEach((el) => { el.textContent = lang; });
        updateThumb();
      });
    });

    bar?.addEventListener("mouseleave", updateThumb);

    if (bar && "ResizeObserver" in window) new ResizeObserver(updateThumb).observe(bar);
    document.fonts?.ready.then(updateThumb);
    updateThumb();

    return { update: updateThumb };
  };

  // ============================================================
  // Главная
  // ============================================================

  const initHeroSlider = () => {
    makeSwiper("hero", $(".hero__slider"), {
      slidesPerView: 1,
      loop: true,
      speed: 1000,
      effect: "fade",
      fadeEffect: { crossFade: true },
      autoplay: { delay: 6000, disableOnInteraction: false },
      pagination: { el: ".hero__pagination", clickable: true },
    });
  };

  const initHeroCard = () => {
    const card = $(".hero__card");
    if (!card) return;

    const KEY = "hero-card-closed";

    if (sessionStore.get(KEY) === "1") card.classList.add("is-hidden");

    $("[data-card-close]", card)?.addEventListener("click", () => {
      card.classList.add("is-hidden");
      sessionStore.set(KEY, "1");
      refreshLayout();
    });
  };

  const initAbout = () => {
    const section = $(".about");
    if (!section) return null;

    const tabs = $$(".about__tab", section);
    const items = $$(".about__item", section);
    if (!tabs.length) return null;

    let active = 0;

    lazyVideo($(".about__video", section));

    const setActive = (index) => {
      if (index === active) return;
      active = index;

      tabs.forEach((el, i) => el.classList.toggle("is-active", i === index));
      items.forEach((el, i) => el.classList.toggle("is-active", i === index));
    };

    const update = (progress) => {
      const index = Math.floor(progress * tabs.length);
      setActive(Math.min(tabs.length - 1, Math.max(0, index)));
    };

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

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => {
        const total = section.offsetHeight - window.innerHeight;
        scrollToY(section.offsetTop + (total * (i + 0.5)) / tabs.length);
      });
    });

    return { setActive };
  };

  const initBook = () => {
    const section = $(".book");
    if (!section || !$(".book__media", section)) return;

    revealOnce(section);
    lazyVideo($(".book__video", section), section);
  };

  const initGallery = () => {
    const section = $(".gallery");
    const slider = section ? $(".gallery__slider", section) : null;
    if (!section || !slider) return null;

    let swiper = null;

    const sync = () => {
      const mobile = window.innerWidth <= 767;

      if (mobile && !swiper) {
        swiper = makeSwiper("gallery", slider, {
          slidesPerView: 1.15,
          spaceBetween: s(12),
          grabCursor: true,
        });
      } else if (!mobile && swiper) {
        swiper.destroy(true, true);
        swiper = null;
        delete state.swipers.gallery;
      }
    };

    sync();
    revealOnce(section, { onMobile: false });

    return { update: sync };
  };

  const initReveals = () => {
    revealOnce($(".home-services"));
    $$(".complex").forEach((section) => revealOnce(section));
  };

  const initCardSliders = () => {
    makeSwiper("news", $(".news__slider"), {
      slidesPerView: 1.25,
      spaceBetween: s(12),
      grabCursor: true,
      breakpoints: {
        768: { slidesPerView: 2 },
        1025: { slidesPerView: 4 },
      },
    });

    makeSwiper("reviews", $(".reviews__slider"), {
      slidesPerView: 1.15,
      spaceBetween: s(12),
      grabCursor: true,
      breakpoints: {
        768: { slidesPerView: 2 },
        1025: { slidesPerView: 3 },
      },
    });
  };

  // ============================================================
  // Контакты, карта, SEO-блок
  // ============================================================

  const initFeedback = () => {
    const section = $(".feedback");
    if (!section) return;

    lazyVideo($(".feedback__video", section), section);
  };

  const initMap = () => {
    const root = $("[data-map]");
    if (!root) return null;

    const plate = $(".feedback__map", root);
    const frame = $("[data-map-frame]", root);
    const opener = $("[data-map-open]", root);
    const closer = $("[data-map-close]", root);
    if (!plate || !frame || !opener || !closer) return null;

    // Карта раскрывается из маленькой плашки
    const syncClip = () => {
      const layer = frame.getBoundingClientRect();
      const rect = plate.getBoundingClientRect();
      if (!layer.width || !rect.width) return;

      const radius = getComputedStyle(plate).borderRadius;

      frame.style.setProperty(
        "--map-clip",
        `inset(${rect.top - layer.top}px ${layer.right - rect.right}px ` +
          `${layer.bottom - rect.bottom}px ${rect.left - layer.left}px round ${radius})`
      );
    };

    const load = () => {
      if ($("iframe", frame) || !root.dataset.src) return;

      const iframe = document.createElement("iframe");
      iframe.src = root.dataset.src;
      iframe.title = "Карта проезда";
      iframe.loading = "lazy";
      iframe.setAttribute("allowfullscreen", "");
      frame.prepend(iframe);
    };

    const setOpen = (open) => {
      if (open) syncClip();

      root.classList.toggle("is-map-open", open);
      opener.setAttribute("aria-expanded", String(open));
    };

    opener.addEventListener("click", () => setOpen(true));
    closer.addEventListener("click", () => setOpen(false));
    onEscape(() => setOpen(false));

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          load();
          observer.disconnect();
        },
        { rootMargin: "20% 0px", threshold: 0 }
      );
      observer.observe(root);
    } else {
      load();
    }

    syncClip();

    return { open: () => setOpen(true), close: () => setOpen(false), sync: syncClip };
  };

  const initSeo = () => {
    const card = $("[data-seo]");
    const toggle = card ? $("[data-seo-toggle]", card) : null;
    if (!card || !toggle) return;

    toggle.addEventListener("click", () => {
      const open = card.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    $(".seo__body", card)?.addEventListener("transitionend", (e) => {
      if (e.propertyName === "grid-template-rows") refreshLayout();
    });
  };

  // ============================================================
  // Внутренние страницы: фильтры и якоря
  // ============================================================

  const initTabsFilter = (section, { items: itemsSel, key, more: moreSel, step = 0 } = {}) => {
    if (!section) return null;

    const items = $$(itemsSel, section);
    const tabs = $$("[data-filter]", section);
    const more = moreSel ? $(moreSel, section) : null;

    if (!items.length || (!tabs.length && !more)) return null;

    let filter = "all";
    let shown = step;

    const render = () => {
      const matched = items.filter((item) => filter === "all" || item.dataset[key] === filter);
      const limit = step ? shown : matched.length;

      items.forEach((item) => { item.hidden = true; });
      matched.slice(0, limit).forEach((item) => { item.hidden = false; });

      if (more) more.hidden = matched.length <= limit;

      refreshLayout();
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        filter = tab.dataset.filter || "all";
        shown = step;
        tabs.forEach((el) => el.classList.toggle("is-active", el === tab));
        render();
      });
    });

    more?.addEventListener("click", () => {
      shown += step;
      render();
    });

    render();

    return { render };
  };

  const initAnchorNav = (section, groupClass) => {
    if (!section) return null;

    const links = $$("[data-anchor]", section);
    if (!links.length) return null;

    const panel = links[0].closest(".tabs");

    const anchorOffset = () => {
      if (!panel) return s(120);

      const stickyTop = parseFloat(getComputedStyle(panel).top) || 0;
      return stickyTop + panel.offsetHeight + s(8);
    };

    const groups = links
      .map((link) => ({ link, target: document.getElementById(link.dataset.anchor) }))
      .filter((item) => item.target?.classList.contains(groupClass));

    const sync = () => {
      const offset = anchorOffset() + s(8);
      let current = links[0];

      groups.forEach(({ link, target }) => {
        if (target.getBoundingClientRect().top <= offset) current = link;
      });

      links.forEach((link) => link.classList.toggle("is-active", link === current));
    };

    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        const target = document.getElementById(link.dataset.anchor);
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        scrollToY(window.scrollY + target.getBoundingClientRect().top - anchorOffset());
      });
    });

    window.addEventListener("scroll", sync, { passive: true });
    sync();

    return { sync };
  };

  const initNewsPage = () =>
    initTabsFilter($(".news-page"), {
      items: "[data-category]",
      key: "category",
      more: "[data-news-more]",
      step: 8,
    });

  const initServicesPage = () =>
    initTabsFilter($(".services-page"), { items: "[data-category]", key: "category" });

  const initProducts = () => initAnchorNav($(".products"), "products__group");

  const initMenu = () => {
    const section = $(".menu");
    if (!section) return null;

    makeSwiper("menu", $(".menu__gallery", section), {
      slidesPerView: "auto",
      spaceBetween: s(8),
      grabCursor: true,
      centeredSlides: true,
      loop: true,
    });

    return initAnchorNav(section, "menu__group");
  };

  const initSchedule = () => lazyVideo($(".schedule__video"));

  // ============================================================
  // Поля выбора, билеты, модалки, формы
  // ============================================================

  const initFields = () => {
    const fields = $$("[data-field]");
    if (!fields.length) return null;

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
        minDate: "today",
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
        e.stopPropagation();

        // клики внутри самого календаря обрабатывает flatpickr
        if (e.target.closest(".flatpickr-calendar")) return;

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
    onEscape(() => closeAll());

    return { close: () => closeAll() };
  };

  const formatPrice = (value) =>
    `${Math.round(value).toLocaleString("ru-RU").replace(/[  ]/g, " ")} ₸`;

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

    const qtyOf = (card) => Number(card.dataset.qty || 0);

    // ---- Карточка и нижняя панель ----

    const renderCard = (card) => {
      const qty = qtyOf(card);

      $("[data-ticket-add]", card).hidden = qty > 0;

      const counter = $("[data-ticket-counter]", card);
      counter.hidden = qty === 0;
      $("[data-ticket-value]", counter).value = qty || 1;
    };

    const renderBar = () => {
      if (!bar) return;

      const sumBy = (field) =>
        cards.reduce((sum, card) => sum + qtyOf(card) * Number(card.dataset[field] || 0), 0);

      const total = sumBy("price");
      const old = sumBy("oldPrice");

      if (barPrice) barPrice.textContent = formatPrice(total);
      if (barOld) {
        barOld.textContent = formatPrice(old);
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

    // ---- Шторка с описанием билета ----

    const fillDrawer = (card) => {
      const image = $("[data-drawer-image]", drawer);
      const cardImage = $("[data-ticket-image]", card);
      if (image && cardImage) {
        image.src = cardImage.src;
        image.alt = cardImage.alt;
      }

      const setText = (sel, value) => {
        const el = $(sel, drawer);
        if (el) el.textContent = value;
      };

      const textOf = (sel) => $(sel, card)?.textContent.trim() ?? "";

      setText("[data-drawer-title]", textOf("[data-ticket-title]"));
      setText("[data-drawer-note]", textOf("[data-ticket-note]"));
      setText("[data-drawer-desc]", textOf("[data-ticket-desc]"));
      setText("[data-drawer-price]", formatPrice(Number(card.dataset.price || 0)));
      setText("[data-drawer-old]", formatPrice(Number(card.dataset.oldPrice || 0)));
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

      onEscape(closeDrawer);
    }

    cards.forEach((card) => {
      card.dataset.qty = card.dataset.qty || "0";
      renderCard(card);

      $("[data-ticket-add]", card).addEventListener("click", () => setQty(card, 1));
      $("[data-ticket-plus]", card).addEventListener("click", () => setQty(card, qtyOf(card) + 1));
      $("[data-ticket-minus]", card).addEventListener("click", () => setQty(card, qtyOf(card) - 1));
      $("[data-ticket-more]", card).addEventListener("click", () => openDrawer(card));
    });

    renderBar();

    return { open: openDrawer, close: closeDrawer };
  };

  const initModals = ({ scrollLock, closeMobileMenu }) => {
    const wrapper = $(".modals");
    if (!wrapper) return null;

    const modals = $$(".modal", wrapper);
    const modalByType = (type) => $(`.modal[data-type="${type}"]`, wrapper);

    let isOpen = false;

    const setWrapperOpen = (open) => {
      isOpen = open;
      wrapper.style.opacity = open ? "1" : "0";
      wrapper.style.pointerEvents = open ? "auto" : "none";

      if (open) scrollLock?.lock?.("modal");
      else scrollLock?.unlock?.("modal");
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

        if (label) el.dataset.label = label;
        else delete el.dataset.label;
      });
    };

    const openModal = (type) => {
      closeMobileMenu?.();

      modals.forEach((modal) => {
        modal.classList.remove("open");
        modal.style.removeProperty("transform");
      });

      const modal = modalByType(type);
      if (!modal) return;

      modal.classList.add("open");
      setWrapperOpen(true);

      window.gsap?.fromTo(modal, { y: -100 }, { y: 0, duration: 0.5, ease: "power3.out" });
    };

    const closeModal = () => {
      const current = modals.find((modal) => modal.classList.contains("open"));

      const finish = () => {
        current?.classList.remove("open");
        setWrapperOpen(false);
      };

      if (!current || !window.gsap) {
        finish();
        return;
      }

      window.gsap.to(current, {
        y: -100,
        duration: 0.4,
        ease: "power3.in",
        onComplete: () => {
          current.style.removeProperty("transform");
          finish();
        },
      });
    };

    $$(".modal-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();

        const type = btn.dataset.type;
        if (!type) return;

        const modal = modalByType(type);
        fillFromCard(modal, btn);
        fillTopic(modal, btn);
        openModal(type);
      });
    });

    wrapper.addEventListener("click", (e) => {
      const onBackdrop = e.target === wrapper;
      const onCloseBtn = e.target.closest(".modal__close, [data-modal-close]");
      if (onBackdrop || onCloseBtn) closeModal();
    });

    onEscape(() => {
      if (isOpen) closeModal();
    });

    return { open: openModal, close: closeModal };
  };

  const initForms = () => {
    // TODO: отправка на бэкенд и окно «заявка отправлена»
    $$(".form").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        form.reset();
      });
    });
  };

  const formatPhone = (value, matrix) => {
    const prefix = matrix.replace(/\D/g, "");
    const slots = (matrix.match(/[_\d]/g) || []).length;
    const free = slots - prefix.length;
    const head = matrix.slice(0, matrix.indexOf("_"));

    let body = value.startsWith(head)
      ? value.slice(head.length).replace(/\D/g, "")
      : value.replace(/\D/g, "");

    if (prefix === "7" && body.startsWith("8")) {
      body = body.slice(1);
    } else if (body.length > free && body.startsWith(prefix)) {
      body = body.slice(prefix.length);
    }

    body = body.slice(0, free);
    if (!body) return "";

    const digits = prefix + body;
    let result = "";
    let i = 0;

    for (const ch of matrix) {
      if (!/[_\d]/.test(ch)) {
        result += ch;
        continue;
      }
      if (i >= digits.length) break;
      result += digits[i++];
    }

    return result.replace(/\D+$/, "");
  };

  const initPhoneMask = () => {
    $$('input[type="tel"]').forEach((input) => {
      const matrix = input.dataset.mask || "+7 (___) ___ ____";
      const prefix = matrix.replace(/\D/g, "");

      input.addEventListener("input", (e) => {
        const entered = input.value.replace(/\D/g, "");

        if (e.inputType?.startsWith("delete") && entered.length <= prefix.length) {
          input.value = "";
          return;
        }

        input.value = formatPhone(input.value, matrix);
      });
    });
  };

  // ============================================================
  // Прелоудер и интро
  // ============================================================

  const PRELOADER_ONCE_PER_DAY = false;

  const initPreloader = ({ scrollLock }) => {
    const root = $(".preloader");
    if (!root) {
      preloaderSignal.fire();
      return;
    }

    const KEY = "preloader-shown-date";
    const today = new Date().toISOString().slice(0, 10);

    if (PRELOADER_ONCE_PER_DAY && localStore.get(KEY) === today) {
      root.remove();
      preloaderSignal.fire();
      return;
    }

    const finish = () => {
      root.classList.add("is-hidden");
      scrollLock?.unlock?.("preloader");
      preloaderSignal.fire();

      if (PRELOADER_ONCE_PER_DAY) localStore.set(KEY, today);

      root.addEventListener("transitionend", () => root.remove(), { once: true });
    };

    scrollLock?.lock?.("preloader");

    const shine = $(".preloader__logo-shine", root);
    if (!shine) {
      finish();
      return;
    }

    shine.addEventListener("animationend", finish, { once: true });
    root.classList.add("is-animating");
  };

  const initIntro = () => {
    let started = false;

    const start = () => {
      if (started) return;
      started = true;

      introSignal.fire();
      document.documentElement.classList.remove("is-loading");
      refreshLayout();
    };

    preloaderSignal.then(() => {
      if (document.readyState === "complete") {
        requestAnimationFrame(start);
        return;
      }

      window.addEventListener("load", () => requestAnimationFrame(start), { once: true });
      setTimeout(start, 1500);
    });
  };

  const initHeroIntro = () => {
    if (!$(".hero")) return;

    introSignal.then(() => {
      if (typeof gsap === "undefined") return;

      const offsets = {
        ".header__container > *": s(-20),
        ".hero__title": s(40),
        ".hero__desc": s(30),
        ".hero__button": s(20),
        ".hero__bottom > *": s(20),
      };

      Object.entries(offsets).forEach(([sel, y]) => gsap.set(sel, { y, opacity: 0 }));

      const show = { y: 0, opacity: 1 };
      const tl = gsap.timeline({
        defaults: { ease: "power3.out", duration: 1, clearProps: "all" },
      });

      tl.to(".header__container > *", { ...show, stagger: 0.1 })
        .to(".hero__title", show, "-=0.8")
        .to(".hero__desc", show, "-=0.75")
        .to(".hero__button", show, "-=0.75")
        .to(".hero__bottom > *", { ...show, stagger: 0.1 }, "-=0.7");

      setTimeout(() => {
        if (tl.progress() < 1) tl.progress(1);
      }, 4000);
    });
  };

  // ============================================================
  // Старт
  // ============================================================

  document.addEventListener("DOMContentLoaded", () => {
    updateMultiplier();

    const lenis = initLenis();
    const scrollLock = createScrollLock(lenis);

    // Падение одного блока не должно уносить всю остальную инициализацию.
    const safe = (name, fn) => {
      try {
        return fn();
      } catch (e) {
        console.error(`[init] ${name}`, e);
        return null;
      }
    };

    safe("fancybox", initFancybox);
    safe("preloader", () => initPreloader({ scrollLock }));

    // Шапка и навигация
    safe("header", initHeader);
    const mobileMenu = safe("burger", () => initBurger({ scrollLock }));
    const lang = safe("lang", initLang);

    // Главная
    safe("heroSlider", initHeroSlider);
    safe("heroCard", initHeroCard);
    safe("about", initAbout);
    safe("book", initBook);
    const gallery = safe("gallery", initGallery);
    safe("reveals", initReveals);
    safe("cardSliders", initCardSliders);

    // Контакты и SEO-блок
    safe("feedback", initFeedback);
    const map = safe("map", initMap);
    safe("seo", initSeo);

    // Внутренние страницы
    safe("newsPage", initNewsPage);
    safe("servicesPage", initServicesPage);
    safe("menu", initMenu);
    safe("products", initProducts);
    safe("schedule", initSchedule);

    // Поля, билеты, модалки, формы
    safe("fields", initFields);
    safe("tickets", () => initTickets({ scrollLock }));
    safe("modals", () => initModals({ scrollLock, closeMobileMenu: mobileMenu?.close }));
    safe("forms", initForms);
    safe("phoneMask", initPhoneMask);

    // Интро запускаем последним — оно снимает is-loading и размораживает раскладку
    safe("heroIntro", initHeroIntro);
    initIntro();

    refreshLayout();
    initLayoutWatcher();

    window.addEventListener("resize", debounce(() => {
      updateMultiplier();
      lang?.update?.();
      gallery?.update?.();
      map?.sync?.();
      refreshLayout();
    }, 150));
  });
})();