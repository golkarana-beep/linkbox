// ========== مدیریت داده‌ها (LocalStorage + ابر) ==========
const STORAGE_KEY = "link-manager-data-v3";
const SYNC_CONFIG_KEY = "link-manager-sync-config";
const LOCAL_THEME_KEY = "linkbox-local-theme-v1";
const PERSONAL_CATEGORY_ID = "personal";
const GUEST_LINKS_KEY = "linkbox-guest-personal-links-v1";
const ACTIVE_CATEGORY_KEY = "linkbox-active-category-v1";
function loadActiveCategory() { try { return localStorage.getItem(ACTIVE_CATEGORY_KEY) || null; } catch { return null; } }
function saveActiveCategory(id) { try { localStorage.setItem(ACTIVE_CATEGORY_KEY, id); } catch {} }
function loadGuestLinks() { try { const value = JSON.parse(localStorage.getItem(GUEST_LINKS_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
let guestLinks = loadGuestLinks();
function saveGuestLinks() { try { localStorage.setItem(GUEST_LINKS_KEY, JSON.stringify(guestLinks)); } catch { alert("حافظه مرورگر پر شده است؛ بعضی لینک‌ها ذخیره نشدند."); } }
function ensurePersonalCategory() { if (!state.categories.some(c => c.id === PERSONAL_CATEGORY_ID)) state.categories.push({ id: PERSONAL_CATEGORY_ID, name: "شخصی", isSystem: true, color: "#9b59b6" }); }
const SUPABASE_URL = window.LINKBOX_CONFIG?.supabaseUrl || "";
const SUPABASE_ANON_KEY = window.LINKBOX_CONFIG?.supabaseAnonKey || "";
const supabaseClient = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes("YOUR_PROJECT")) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let adminSession = null;
let cloudSaveTimer = null;

const defaultData = {
  categories: [
    { id: "all", name: "همه لینک‌ها", isSystem: true, color: "#4f6ef7" },
    { id: "cat-1", name: "کار", isSystem: false, color: "#4f6ef7" },
    { id: "cat-2", name: "سرگرمی", isSystem: false, color: "#e74c3c" },
    { id: "cat-3", name: "آموزش", isSystem: false, color: "#27ae60" },
  ],
  links: [],
  theme: "light",
  activeCategory: "all",
  updatedAt: 0,
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultData);
    const parsed = JSON.parse(raw);
    if (!parsed.categories.some((c) => c.id === "all")) {
      parsed.categories.unshift({ id: "all", name: "همه لینک‌ها", isSystem: true, color: "#4f6ef7" });
    }
    parsed.categories.forEach((c) => { if (!c.color) c.color = "#4f6ef7"; });
    return { ...defaultData, ...parsed };
  } catch {
    return structuredClone(defaultData);
  }
}

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { enabled: false, apiKey: "", binId: "" };
    return JSON.parse(raw);
  } catch {
    return { enabled: false, apiKey: "", binId: "" };
  }
}

function saveSyncConfig(cfg) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

let syncConfig = loadSyncConfig();
let syncTimer = null;
let isSyncing = false;
let localCloudDirty = false;

function saveData(data, options = {}) {
  data.updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      alert("حافظه مرورگر پر شد. لطفاً چند لینک یا عکس را حذف کنید.");
    }
  }
  // تغییرات مدیر تا تأیید موفق سرور «در انتظار ذخیره» می‌مانند تا pull دوره‌ای آن‌ها را بازنویسی نکند.
  if (!options.skipCloud && adminSession && supabaseClient) {
    localCloudDirty = true;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => pushToCloud(false), 900);
  }
}

let state = loadData();
const rememberedCategory = loadActiveCategory();
if (rememberedCategory) state.activeCategory = rememberedCategory;
ensurePersonalCategory();
let searchQuery = "";
let pendingImageData = null;

// ========== المان‌ها ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const categoryList = $("#category-list");
const linksContainer = $("#links-container");
const emptyState = $("#empty-state");
const noResults = $("#no-results");
const currentCategoryTitle = $("#current-category-title");
const linkCount = $("#link-count");
const themeToggle = $("#theme-toggle");
const themeIcon = themeToggle.querySelector(".theme-icon");
const searchInput = $("#search-input");
const searchClear = $("#search-clear");

const linkForm = $("#link-form");
const linkModalTitle = $("#link-modal-title");
const linkIdInput = $("#link-id");
const linkTitleInput = $("#link-title");
const linkUrlInput = $("#link-url");
const linkCategorySelect = $("#link-category");
const linkDescInput = $("#link-desc");
const linkImageInput = $("#link-image");
const linkImageDataInput = $("#link-image-data");
const linkImageFile = $("#link-image-file");
const imagePreview = $("#image-preview");

const categoryForm = $("#category-form");
const categoryNameInput = $("#category-name");
const categoryColorInput = $("#category-color");

const confirmMessage = $("#confirm-message");
const confirmDeleteBtn = $("#confirm-delete-btn");

let pendingDelete = null;

// ========== تم (روشن → دارک → طوسی) ==========
const THEMES = ["light", "dark", "slate"];
const THEME_ICONS = { light: "🌙", dark: "☀️", slate: "🩶" };

function getSavedLocalTheme() {
  try {
    const saved = localStorage.getItem(LOCAL_THEME_KEY);
    return THEMES.includes(saved) ? saved : null;
  } catch { return null; }
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "light";
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.textContent = THEME_ICONS[theme] || "🌙";
  state.theme = theme;
  // Theme is a device-only preference; never sync it to the shared cloud record.
  try { localStorage.setItem(LOCAL_THEME_KEY, theme); } catch (e) { console.warn("Could not save local theme", e); }
  saveData(state, { skipCloud: true });
}

function toggleTheme() {
  const idx = THEMES.indexOf(state.theme);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
}

// ========== ساعت عقربه‌ای ==========
function updateClock() {
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hourDeg = h * 30 + m * 0.5;
  const minDeg = m * 6 + s * 0.1;
  const secDeg = s * 6;
  const hourHand = document.getElementById("hour-hand");
  const minuteHand = document.getElementById("minute-hand");
  const secondHand = document.getElementById("second-hand");
  if (hourHand) hourHand.style.transform = `rotate(${hourDeg}deg)`;
  if (minuteHand) minuteHand.style.transform = `rotate(${minDeg}deg)`;
  if (secondHand) secondHand.style.transform = `rotate(${secDeg}deg)`;
}

// ========== تاریخ شمسی (جلالی) ==========
const JALALI_WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
];

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

function updateJalaliDate() {
  const now = new Date();
  const { jy, jm, jd } = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const weekday = JALALI_WEEKDAYS[now.getDay()];
  const weekdayEl = document.getElementById("jalali-weekday");
  const fullEl = document.getElementById("jalali-full");
  if (weekdayEl) weekdayEl.textContent = weekday;
  if (fullEl) fullEl.textContent = `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
}

// ========== کش تصویر برای آفلاین ==========
/** تبدیل URL تصویر به base64 و ذخیره در لینک */
async function cacheImageAsBase64(url) {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    // فقط تصاویر کوچک‌تر از ~500KB
    if (blob.size > 500 * 1024) return null;
    return await blobToBase64(blob);
  } catch {
    // fallback: canvas برای فاویکون‌ها (ممکن است CORS بزند)
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  } catch {
    return null;
  }
}

/** منبع نهایی نمایش تصویر (اولویت: cached > image > favicon) */
function getDisplayImage(link) {
  if (link.imageCached) return link.imageCached;
  if (link.image) return link.image;
  return getFaviconUrl(link.url);
}

/** وقتی آنلاین هستیم، فاویکون/عکس را کش کن */
async function ensureImageCached(link) {
  if (link.imageCached) return link;
  if (!navigator.onLine) return link;

  let src = link.image || getFaviconUrl(link.url);
  if (!src || src.startsWith("data:")) {
    if (src && src.startsWith("data:")) {
      link.imageCached = src;
    }
    return link;
  }

  const cached = await cacheImageAsBase64(src);
  if (cached) {
    link.imageCached = cached;
    // ذخیره در state
    const idx = state.links.findIndex((l) => l.id === link.id);
    if (idx !== -1) {
      state.links[idx].imageCached = cached;
      saveData(state);
    }
  }
  return link;
}

// ========== رندر دسته‌بندی‌ها (نوار افقی ۳ بعدی) ==========
function renderCategories() {
  categoryList.innerHTML = "";

  state.categories.forEach((cat) => {
    const count =
      cat.id === "all"
        ? state.links.length
        : cat.id === PERSONAL_CATEGORY_ID
          ? guestLinks.length
          : state.links.filter((l) => l.categoryId === cat.id).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-chip${state.activeCategory === cat.id ? " active" : ""}`;
    btn.style.background = `linear-gradient(145deg, ${lighten(cat.color, 12)}, ${cat.color})`;
    btn.dataset.id = cat.id;

    btn.innerHTML = `
      <span>${escapeHtml(cat.name)}</span>
      <span class="cat-count">${count}</span>
      ${
        (!cat.isSystem && cat.id !== PERSONAL_CATEGORY_ID)
          ? `<span class="cat-delete" data-action="delete-cat" title="حذف دسته‌بندی">✕</span>`
          : ""
      }
    `;

    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      state.activeCategory = cat.id;
      saveActiveCategory(cat.id);
      saveData(state);
      renderCategories();
      renderLinks();
    });

    const del = btn.querySelector('[data-action="delete-cat"]');
    if (del) {
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        openConfirm(`آیا می‌خواهید دسته‌بندی «${cat.name}» را حذف کنید؟`, {
          type: "category",
          id: cat.id,
        });
      });
    }

    categoryList.appendChild(btn);
  });
}

function lighten(hex, percent) {
  try {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = Math.min(255, (num >> 16) + Math.round(2.55 * percent));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * percent));
    const b = Math.min(255, (num & 0xff) + Math.round(2.55 * percent));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  } catch {
    return hex;
  }
}

// ========== فیلتر ==========
function getFilteredLinks() {
  let links =
    state.activeCategory === PERSONAL_CATEGORY_ID
      ? [...guestLinks]
      : state.activeCategory === "all"
        ? [...state.links]
        : state.links.filter((l) => l.categoryId === state.activeCategory);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    links = links.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        (l.desc && l.desc.toLowerCase().includes(q))
    );
  }
  return links;
}

// ========== رندر لینک‌ها ==========
function renderLinks() {
  const links = getFilteredLinks();
  const activeCat = state.categories.find((c) => c.id === state.activeCategory);

  currentCategoryTitle.textContent = activeCat ? activeCat.name : "همه لینک‌ها";
  linkCount.textContent = links.length;

  linksContainer.innerHTML = "";
  emptyState.classList.add("hidden");
  noResults.classList.add("hidden");

  if (links.length === 0) {
    if (searchQuery) noResults.classList.remove("hidden");
    else emptyState.classList.remove("hidden");
    return;
  }

  links.forEach((link) => {
    const cat = state.categories.find((c) => c.id === link.categoryId);
    const imgSrc = getDisplayImage(link);
    // عکس سفارشی (آپلود یا URL) به‌صورت cover؛ فاویکون به‌صورت آیکون وسط
    const isCustomImage = !!(link.image || (link.imageCached && link.image));
    const useCover = isCustomImage && imgSrc && !imgSrc.includes("favicons");

    const card = document.createElement("div");
    card.className = "link-card";
    card.setAttribute("role", "link");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `باز کردن ${link.title}`);
    const openLink = () => window.open(link.url, "_blank", "noopener,noreferrer");
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;
      openLink();
    });
    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button, a")) {
        event.preventDefault(); openLink();
      }
    });

    const iconHtml = imgSrc
      ? `<img src="${escapeAttr(imgSrc)}" alt="" class="link-card-icon${useCover ? " cover" : ""}" loading="lazy"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
         <span class="link-card-icon-fallback" style="display:none">✦</span>`
      : `<span class="link-card-icon-fallback">✦</span>`;

    card.innerHTML = `
      <div class="link-card-icon-area">${iconHtml}</div>
      <div class="link-card-actions" aria-label="عملیات لینک">
        <button class="btn-icon" data-action="edit" title="ویرایش" aria-label="ویرایش لینک">✏️</button>
        <button class="btn-icon danger" data-action="delete" title="حذف" aria-label="حذف لینک">🗑️</button>
      </div>
      <div class="link-card-title">${escapeHtml(link.title)}</div>
    `;

    card.dataset.url = link.url;
    card.querySelector('[data-action="edit"]').dataset.linkId = link.id;
    card.querySelector('[data-action="delete"]').dataset.linkId = link.id;
    card.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLinkModal(link);
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openConfirm(`آیا می‌خواهید لینک «${link.title}» را حذف کنید؟`, {
        type: "link",
        id: link.id,
      });
    });

    linksContainer.appendChild(card);

    if (!link.imageCached && navigator.onLine) {
      ensureImageCached(link);
    }
  });
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ========== مودال لینک ==========
function populateCategorySelect(selectedId = null) {
  linkCategorySelect.innerHTML = "";
  const cats = adminSession ? state.categories.filter((c) => !c.isSystem && c.id !== PERSONAL_CATEGORY_ID) : state.categories.filter((c) => c.id === PERSONAL_CATEGORY_ID);
  if (cats.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "ابتدا یک دسته‌بندی بسازید";
    opt.disabled = true;
    opt.selected = true;
    linkCategorySelect.appendChild(opt);
    return;
  }
  cats.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    if (selectedId && selectedId === cat.id) opt.selected = true;
    linkCategorySelect.appendChild(opt);
  });
}

function openLinkModal(link = null) {
  pendingImageData = null;
  linkImageFile.value = "";
  switchImageTab("url");

  if (link) {
    linkModalTitle.textContent = "ویرایش لینک";
    linkIdInput.value = link.id;
    linkTitleInput.value = link.title;
    linkUrlInput.value = link.url;
    linkDescInput.value = link.desc || "";
    linkImageInput.value = link.image && !link.image.startsWith("data:") ? link.image : "";
    linkImageDataInput.value = link.imageCached || (link.image && link.image.startsWith("data:") ? link.image : "");
    pendingImageData = linkImageDataInput.value || null;
    populateCategorySelect(link.categoryId);
  } else {
    linkModalTitle.textContent = "افزودن لینک جدید";
    linkIdInput.value = "";
    linkTitleInput.value = "";
    linkUrlInput.value = "";
    linkDescInput.value = "";
    linkImageInput.value = "";
    linkImageDataInput.value = "";
    populateCategorySelect(adminSession ? (state.activeCategory !== "all" && state.activeCategory !== PERSONAL_CATEGORY_ID ? state.activeCategory : null) : PERSONAL_CATEGORY_ID);
  }
  updateImagePreview();
  openModal("link-modal");
  setTimeout(() => linkTitleInput.focus(), 100);
}

function updateImagePreview() {
  imagePreview.innerHTML = "";
  let src = pendingImageData || linkImageDataInput.value || linkImageInput.value.trim();

  if (!src) {
    const url = linkUrlInput.value.trim();
    if (url) {
      let finalUrl = url;
      if (!/^https?:\/\//i.test(finalUrl)) finalUrl = "https://" + finalUrl;
      src = getFaviconUrl(finalUrl);
    }
  }

  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "پیش‌نمایش";
    img.onerror = () => {
      imagePreview.innerHTML = '<span class="preview-placeholder">📷</span>';
    };
    imagePreview.appendChild(img);
  } else {
    imagePreview.innerHTML = '<span class="preview-placeholder">📷</span>';
  }
}

async function handleLinkSubmit(e) {
  e.preventDefault();

  const title = linkTitleInput.value.trim();
  let url = linkUrlInput.value.trim();
  const categoryId = linkCategorySelect.value;
  const desc = linkDescInput.value.trim();
  const imageUrl = linkImageInput.value.trim();
  const id = linkIdInput.value;

  if (!title || !url) return;
  if (!categoryId) {
    alert("لطفاً ابتدا یک دسته‌بندی بسازید.");
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  // مهمان فقط لینک‌های دسته‌بندی شخصی خودش را در همین مرورگر مدیریت می‌کند.
  if (!adminSession) {
    const personalLink = { id: id || ("guest-link-" + Date.now()), title, url, categoryId: PERSONAL_CATEGORY_ID, desc, image: linkImageInput.value.trim() || null, imageCached: pendingImageData || linkImageDataInput.value || null, createdAt: Date.now() };
    const existing = guestLinks.findIndex(l => l.id === id);
    if (existing >= 0) guestLinks[existing] = { ...guestLinks[existing], ...personalLink };
    else guestLinks.push(personalLink);
    saveGuestLinks();
    state.activeCategory = PERSONAL_CATEGORY_ID;
    saveActiveCategory(PERSONAL_CATEGORY_ID);
    saveData(state, { skipCloud: true });
    closeModal("link-modal");
    renderCategories();
    renderLinks();
    return;
  }

  // تصویر نهایی
  let image = imageUrl || null;
  let imageCached = pendingImageData || null;

  // اگر عکس URL داده شده و هنوز کش نشده، سعی کن کش کنی
  if (image && !imageCached && navigator.onLine) {
    imageCached = await cacheImageAsBase64(image);
  }

  // اگر هیچ عکسی نیست، فاویکون را کش کن
  if (!image && !imageCached && navigator.onLine) {
    const fav = getFaviconUrl(url);
    if (fav) {
      imageCached = await cacheImageAsBase64(fav);
    }
  }

  const linkData = {
    title,
    url,
    categoryId,
    desc,
    image: image,
    imageCached: imageCached,
  };

  if (id) {
    const idx = state.links.findIndex((l) => l.id === id);
    if (idx !== -1) {
      state.links[idx] = { ...state.links[idx], ...linkData };
    }
  } else {
    state.links.push({
      id: "link-" + Date.now(),
      ...linkData,
      createdAt: Date.now(),
    });
  }

  saveData(state);
  closeModal("link-modal");
  renderCategories();
  renderLinks();
}

// ========== تب‌های منبع عکس ==========
function switchImageTab(tab) {
  $$(".img-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("#img-url-panel").classList.toggle("hidden", tab !== "url");
  $("#img-file-panel").classList.toggle("hidden", tab !== "file");
}

$$(".img-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchImageTab(tab.dataset.tab));
});

// آپلود از هارد
linkImageFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert("حجم فایل نباید بیشتر از ۲ مگابایت باشد.");
    return;
  }
  if (!file.type.startsWith("image/")) {
    alert("فقط فایل تصویری مجاز است.");
    return;
  }
  try {
    // فشرده‌سازی ساده با canvas اگر بزرگ باشد
    const base64 = await compressImage(file, 400, 0.8);
    pendingImageData = base64;
    linkImageDataInput.value = base64;
    linkImageInput.value = ""; // پاک کردن URL
    updateImagePreview();
  } catch {
    alert("خطا در خواندن فایل.");
  }
});

function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// درگ و دراپ
const fileDrop = document.querySelector(".file-drop");
if (fileDrop) {
  ["dragenter", "dragover"].forEach((ev) => {
    fileDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      fileDrop.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    fileDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      fileDrop.classList.remove("dragover");
    });
  });
  fileDrop.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) {
      linkImageFile.files = e.dataTransfer.files;
      linkImageFile.dispatchEvent(new Event("change"));
    }
  });
}

// ========== مودال دسته‌بندی ==========
function openCategoryModal() {
  categoryNameInput.value = "";
  categoryColorInput.value = "#4f6ef7";
  $$(".color-swatch").forEach((s) => s.classList.remove("active"));
  $$(".color-swatch")[0]?.classList.add("active");
  openModal("category-modal");
  setTimeout(() => categoryNameInput.focus(), 100);
}

function handleCategorySubmit(e) {
  e.preventDefault();
  const name = categoryNameInput.value.trim();
  const color = categoryColorInput.value || "#4f6ef7";
  if (!name) return;
  if (state.categories.some((c) => c.name === name)) {
    alert("این نام دسته‌بندی قبلاً وجود دارد.");
    return;
  }
  state.categories.push({
    id: "cat-" + Date.now(),
    name,
    color,
    isSystem: false,
  });
  saveData(state);
  closeModal("category-modal");
  renderCategories();
  populateCategorySelect();
}

document.getElementById("color-picker").addEventListener("click", (e) => {
  const swatch = e.target.closest(".color-swatch");
  if (!swatch) return;
  $$(".color-swatch").forEach((s) => s.classList.remove("active"));
  swatch.classList.add("active");
  categoryColorInput.value = swatch.dataset.color;
});

// ========== حذف ==========
function openConfirm(message, payload) {
  confirmMessage.textContent = message;
  pendingDelete = payload;
  openModal("confirm-modal");
}

function handleConfirmDelete() {
  if (!pendingDelete) return;
  if (pendingDelete.type === "link") {
    if (!adminSession && guestLinks.some(l => l.id === pendingDelete.id)) {
      guestLinks = guestLinks.filter(l => l.id !== pendingDelete.id);
      saveGuestLinks();
    } else if (adminSession) {
      state.links = state.links.filter((l) => l.id !== pendingDelete.id);
    }
  } else if (pendingDelete.type === "category") {
    state.links = state.links.map((l) =>
      l.categoryId === pendingDelete.id ? { ...l, categoryId: null } : l
    );
    state.categories = state.categories.filter((c) => c.id !== pendingDelete.id);
    if (state.activeCategory === pendingDelete.id) { state.activeCategory = "all"; saveActiveCategory("all"); }
  }
  pendingDelete = null;
  saveData(state);
  closeModal("confirm-modal");
  renderCategories();
  renderLinks();
}

// ========== مودال ==========
function openModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay") || e.target.hasAttribute("data-close")) {
    const modal = e.target.closest(".modal");
    if (modal) modal.classList.add("hidden");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $$(".modal:not(.hidden)").forEach((m) => m.classList.add("hidden"));
});

// ========== جستجو ==========
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  searchClear.classList.toggle("hidden", !searchQuery);
  renderLinks();
});
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  searchClear.classList.add("hidden");
  renderLinks();
  searchInput.focus();
});

linkImageInput.addEventListener("input", () => {
  pendingImageData = null;
  linkImageDataInput.value = "";
  updateImagePreview();
});
linkUrlInput.addEventListener("input", updateImagePreview);
linkUrlInput.addEventListener("blur", updateImagePreview);

// ========== ابزار ==========
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ========== رویدادها ==========
themeToggle.addEventListener("click", toggleTheme);
$("#add-link-btn").addEventListener("click", () => openLinkModal());
$("#add-category-btn").addEventListener("click", openCategoryModal);
linkForm.addEventListener("submit", handleLinkSubmit);
categoryForm.addEventListener("submit", handleCategorySubmit);
confirmDeleteBtn.addEventListener("click", handleConfirmDelete);

// ========== همگام‌سازی ابری (JSONBin.io) ==========
function setSyncStatus(text, type = "") {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = text;
  el.className = "sync-status" + (type ? " " + type : "");
}

function showSyncMessage(text, type) {
  const el = document.getElementById("sync-message");
  if (!el) return;
  el.textContent = text;
  el.className = "sync-message " + type;
  el.classList.remove("hidden");
}

function getCloudPayload() {
  return {
    categories: state.categories.filter(c => c.id !== PERSONAL_CATEGORY_ID),
    links: state.links,
    // Active category and guest personal links are device-local, never synced.
    updatedAt: state.updatedAt || Date.now(),
  };
}

async function pushToCloud(showAlert = true) {
  if (!supabaseClient) { if (showAlert) showSyncMessage("ابتدا تنظیمات Supabase را در config.js وارد کنید.", "err"); return false; }
  if (!adminSession) { if (showAlert) showSyncMessage("برای ذخیره تغییرات باید با حساب مدیر وارد شوید.", "err"); return false; }
  if (isSyncing) { clearTimeout(cloudSaveTimer); cloudSaveTimer = setTimeout(() => pushToCloud(showAlert), 1200); return false; }
  isSyncing = true; setSyncStatus("در حال ذخیره…", "syncing");
  try {
    const payload = getCloudPayload();
    const { error } = await supabaseClient.from("linkbox_content").upsert({ id: 1, data: payload, updated_at: new Date().toISOString() });
    if (error) throw error;
    if ((state.updatedAt || 0) <= (payload.updatedAt || 0)) localCloudDirty = false;
    else { clearTimeout(cloudSaveTimer); cloudSaveTimer = setTimeout(() => pushToCloud(false), 300); }
    setSyncStatus("ذخیره ابری شد ✓", "ok");
    if (showAlert) showSyncMessage("تغییرات با موفقیت در فضای مشترک ذخیره شد.", "ok");
    return true;
  } catch (e) { console.error(e); setSyncStatus("خطا در ذخیره", "err"); if (showAlert) showSyncMessage("ذخیره ناموفق: " + (e.message || "اتصال را بررسی کنید"), "err"); return false; }
  finally { isSyncing = false; }
}

async function pullFromCloud(showAlert = true) {
  // اگر ویرایش محلی هنوز به ابر نرسیده، داده قدیمی سرور نباید جای آن را بگیرد.
  if (localCloudDirty) {
    if (!cloudSaveTimer && adminSession && !isSyncing) pushToCloud(false);
    return false;
  }
  if (!supabaseClient) { setSyncStatus("نیازمند تنظیم Supabase", "err"); if (showAlert) showSyncMessage("config.js را طبق README تنظیم کنید.", "err"); return false; }
  if (isSyncing) return false;
  isSyncing = true;
  if (showAlert) setSyncStatus("در حال دریافت…", "syncing");
  try {
    const { data: row, error } = await supabaseClient.from("linkbox_content").select("data, updated_at").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!row?.data) { setSyncStatus("هنوز اطلاعاتی ذخیره نشده", ""); return true; }
    const remote = row.data;
    if (!Array.isArray(remote.categories)) remote.categories = structuredClone(defaultData.categories);
    if (!remote.categories.some(c => c.id === "all")) remote.categories.unshift({ id:"all", name:"همه لینک‌ها", isSystem:true, color:"#4f6ef7" });
    remote.categories.forEach(c => { if (!c.color) c.color = "#4f6ef7"; });
    if (!Array.isArray(remote.links)) remote.links = [];
    // Polling should not rebuild the DOM unless cloud content actually changed.
    const remoteSignature = JSON.stringify({ categories: remote.categories, links: remote.links });
    const localSignature = JSON.stringify({ categories: state.categories.filter(c => c.id !== PERSONAL_CATEGORY_ID), links: state.links });
    if (remoteSignature === localSignature) {
      setSyncStatus("همگام با سرور ✓", "ok");
      return true;
    }
    const deviceTheme = getSavedLocalTheme() || state.theme || "light";
    const localActiveCategory = loadActiveCategory() || state.activeCategory;
    state = { ...defaultData, ...remote, theme: deviceTheme, activeCategory: localActiveCategory };
    ensurePersonalCategory();
    if (!state.categories.some(c => c.id === state.activeCategory)) { state.activeCategory = "all"; saveActiveCategory("all"); }
    saveData(state, { skipCloud: true });
    applyTheme(deviceTheme); renderCategories(); renderLinks(); updateAdminUI();
    setSyncStatus("همگام با سرور ✓", "ok");
    if (showAlert) showSyncMessage("اطلاعات مشترک دریافت شد.", "ok");
    return true;
  } catch (e) { console.error(e); setSyncStatus("خطا در دریافت", "err"); if (showAlert) showSyncMessage("دریافت ناموفق: " + (e.message || "اتصال را بررسی کنید"), "err"); return false; }
  finally { isSyncing = false; }
}

function openSyncModal() {
  const msg = document.getElementById("sync-message"); if (msg) msg.classList.add("hidden");
  document.getElementById("admin-logout-btn")?.classList.toggle("hidden", !adminSession);
  document.getElementById("admin-password").value = "";
  openModal("sync-modal");
}

function updateAdminUI() {
  const isAdmin = !!adminSession;
  const addLink = document.getElementById("add-link-btn"); if (addLink) addLink.classList.remove("hidden");
  const addCategory = document.getElementById("add-category-btn"); if (addCategory) addCategory.classList.toggle("hidden", !isAdmin);
  const btn = document.getElementById("sync-settings-btn");
  if (btn) btn.textContent = isAdmin ? "مدیر (خروج)" : "ورود مدیر";
  const logout = document.getElementById("admin-logout-btn"); if (logout) logout.classList.toggle("hidden", !isAdmin);
  document.querySelectorAll('[data-action="edit"], [data-action="delete"], .cat-delete').forEach(el => {
    const card = el.closest(".link-card");
    const linkId = card?.querySelector('[data-action="edit"]') ? (card.querySelector('[data-action="edit"]').dataset.linkId || null) : null;
    const guestOwnsLink = !isAdmin && state.activeCategory === PERSONAL_CATEGORY_ID && guestLinks.some(l => l.id === (el.dataset.linkId || linkId) || (card && l.url === card.dataset.url));
    el.classList.toggle("hidden", !isAdmin && !guestOwnsLink);
  });
}

async function initializeCloud() {
  if (!supabaseClient) { setSyncStatus("تنظیم Supabase لازم است", ""); updateAdminUI(); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  adminSession = session;
  updateAdminUI();
  await pullFromCloud(false);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    adminSession = session;
    updateAdminUI();
    if (session) setTimeout(() => pullFromCloud(false), 0);
  });
  // دریافت دوره‌ای برای تازه‌ماندن نمایش در دستگاه‌های مختلف
  // Background sync less frequently to avoid UI churn; pullFromCloud now skips unchanged content.
  setInterval(() => { if (navigator.onLine && !isSyncing && !localCloudDirty) pullFromCloud(false); }, 60000);
}

document.getElementById("admin-login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) { showSyncMessage("ابتدا config.js را طبق راهنما تنظیم کنید.", "err"); return; }
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { showSyncMessage("ورود ناموفق است. ایمیل و رمز را بررسی کنید.", "err"); return; }
  adminSession = data.session; updateAdminUI(); closeModal("sync-modal"); await pullFromCloud(false);
});
document.getElementById("admin-logout-btn")?.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  adminSession = null; updateAdminUI(); closeModal("sync-modal");
});

// خروجی / ورود فایل
function exportData() {
  const blob = new Blob([JSON.stringify(getCloudPayload(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `linkbox-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.categories && !data.links) throw new Error("فرمت نامعتبر");
      if (!Array.isArray(data.categories)) data.categories = structuredClone(defaultData.categories);
      if (!data.categories.some((c) => c.id === "all")) {
        data.categories.unshift({ id: "all", name: "همه لینک‌ها", isSystem: true, color: "#4f6ef7" });
      }
      if (!Array.isArray(data.links)) data.links = [];
      state = { ...defaultData, ...data };
      saveData(state);
      applyTheme(state.theme || "light");
      renderCategories();
      renderLinks();
      showSyncMessage("فایل با موفقیت وارد شد.", "ok");
      alert("داده‌ها وارد شد.");
    } catch (e) {
      alert("خطا در خواندن فایل: " + (e.message || ""));
    }
  };
  reader.readAsText(file);
}

// رویدادهای همگام‌سازی
document.getElementById("sync-settings-btn")?.addEventListener("click", async () => { if (adminSession && supabaseClient) { await supabaseClient.auth.signOut(); adminSession = null; updateAdminUI(); } else openSyncModal(); });



document.getElementById("export-btn")?.addEventListener("click", exportData);
document.getElementById("import-btn")?.addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importData(file);
  e.target.value = "";
});

// ========== منوی بالای صفحه و گالری عکس ==========
const menuToggle = document.getElementById("top-menu-toggle");
const topMenu = document.getElementById("top-menu");
const galleryPage = document.getElementById("gallery-page");
const linksPage = document.querySelector(".content");
const categoriesBar = document.querySelector(".categories-bar-wrap");
const galleryNavBtn = document.getElementById("gallery-nav-btn");
let galleryLoaded = false;
let galleryRequest = 0;
let galleryQuery = "landscape nature";

menuToggle?.addEventListener("click", () => {
  const open = topMenu.classList.toggle("hidden") === false;
  menuToggle.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
  if (topMenu && !topMenu.contains(event.target) && !menuToggle?.contains(event.target)) {
    topMenu.classList.add("hidden"); menuToggle?.setAttribute("aria-expanded", "false");
  }
});
function showGallery(show) {
  galleryPage?.classList.toggle("hidden", !show);
  linksPage?.classList.toggle("hidden", show);
  categoriesBar?.classList.toggle("hidden", show);
  document.querySelector(".header-center")?.classList.toggle("hidden", show);
  if (galleryNavBtn) galleryNavBtn.innerHTML = show ? "<span>←</span> بازگشت به لینک‌ها" : "<span>▧</span> گالری عکس";
  if (show && !galleryLoaded) loadGallery(galleryQuery);
  topMenu?.classList.add("hidden"); menuToggle?.setAttribute("aria-expanded", "false");
}
galleryNavBtn?.addEventListener("click", () => showGallery(galleryPage.classList.contains("hidden")));

async function loadGallery(query = "landscape nature") {
  const grid = document.getElementById("gallery-grid");
  const status = document.getElementById("gallery-status");
  if (!grid || !status) return;
  galleryQuery = query;
  const requestId = ++galleryRequest;
  status.textContent = "در حال جستجوی عکس‌های باکیفیت در اینترنت…";
  grid.innerHTML = "";
  try {
    const params = new URLSearchParams({
      action: "query", format: "json", origin: "*", generator: "search",
      gsrsearch: query, gsrnamespace: "6", gsrlimit: "40", gsrwhat: "text",
      prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1920"
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
    if (!response.ok) throw new Error("خطا در دریافت تصاویر");
    const data = await response.json();
    if (requestId !== galleryRequest) return;
    const pages = Object.values(data.query?.pages || {}).filter(page => {
      const info = page.imageinfo?.[0];
      const width = Number(info?.width || 0), height = Number(info?.height || 0);
      return info && (info.thumburl || info.url) && width >= 1280 && height >= 720 && width / height >= 1.45;
    }).sort((a,b) => {
      const ai = a.imageinfo[0], bi = b.imageinfo[0];
      return (bi.width * bi.height) - (ai.width * ai.height);
    });
    if (!pages.length) { status.textContent = "تصویری پیدا نشد؛ عبارت دیگری جستجو کنید."; galleryLoaded = true; return; }
    for (const page of pages) {
      const info = page.imageinfo[0];
      const title = page.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").replaceAll("_", " ");
      const card = document.createElement("article"); card.className = "gallery-item";
      const img = document.createElement("img"); img.loading = "lazy"; img.alt = title;
      img.src = info.thumburl || info.url; img.width = 1920; img.height = 1080;
      const source = document.createElement("a"); source.href = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`; source.target = "_blank"; source.rel = "noopener noreferrer"; source.innerHTML = `<span>${escapeHtml(title)}</span>`;
      const download = document.createElement("a"); download.className = "gallery-download"; download.href = info.url; download.target = "_blank"; download.rel = "noopener noreferrer"; download.textContent = "نمایش تصویر اصلی ↗"; download.title = "بازکردن تصویر با کیفیت اصلی";
      card.append(img, source, download); grid.appendChild(card);
    }
    status.textContent = `${pages.length} تصویر باکیفیت پیدا شد · نمایش 16:9 · برای دریافت نسخه اصلی روی «نمایش تصویر اصلی» بزنید.`;
    galleryLoaded = true;
  } catch (error) {
    if (requestId !== galleryRequest) return;
    galleryLoaded = false;
    status.textContent = "دریافت تصاویر انجام نشد. اتصال اینترنت را بررسی کنید و روی «تصاویر جدید» بزنید.";
    console.warn("Gallery loading failed", error);
  }
}
document.getElementById("gallery-refresh")?.addEventListener("click", () => { galleryLoaded = false; loadGallery(galleryQuery); });
document.getElementById("gallery-search-form")?.addEventListener("submit", event => {
  event.preventDefault(); const query = document.getElementById("gallery-search-input").value.trim();
  galleryLoaded = false; loadGallery(query || "landscape nature");
});

// ========== شروع ==========
// Restore this device's own theme before cloud data is loaded.
applyTheme(getSavedLocalTheme() || state.theme || "light");

// Cache the app shell so the page can open after it has been visited online once.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Offline cache unavailable", err));
  });
}
renderCategories();
renderLinks();
updateClock();
updateJalaliDate();
setInterval(updateClock, 1000);
setInterval(updateJalaliDate, 60000);

initializeCloud();

window.addEventListener("online", () => {
  state.links.forEach((link) => {
    if (!link.imageCached) ensureImageCached(link);
  });
  if (supabaseClient) pullFromCloud(false);
});

// Guest mode: block any mutation form submission unless an authenticated manager is present.
document.getElementById("category-form")?.addEventListener("submit", e => { if (!adminSession) { e.preventDefault(); e.stopImmediatePropagation(); openSyncModal(); } }, true);

document.addEventListener("click", (e) => {
  const action = e.target.closest('[data-action="edit"], [data-action="delete"], .cat-delete');
  if (!action || adminSession) return;
  const linkId = action.dataset.linkId;
  const isGuestPersonalLink = state.activeCategory === PERSONAL_CATEGORY_ID && !!linkId && guestLinks.some(l => l.id === linkId);
  if (isGuestPersonalLink && (action.dataset.action === "edit" || action.dataset.action === "delete")) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
