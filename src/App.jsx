import { useState, useEffect, useRef } from "react";

const SIZE_GROUPS = [
  {
    label: "Adult clothing sizes",
    options: ["Adult XS", "Adult S", "Adult M", "Adult L", "Adult XL", "Adult XXL"],
  },
  {
    label: "Child clothing sizes",
    options: ["Child XS", "Child S", "Child M", "Child L", "Child XL", "Child XXL"],
  },
  {
    label: "Dobok height sizes",
    options: [
      "80 cm height", "90 cm height", "100 cm height", "110 cm height",
      "120 cm height", "130 cm height", "140 cm height", "150 cm height",
      "160 cm height", "170 cm height", "180 cm height", "190 cm height",
      "200 cm height", "210 cm height", "220 cm height",
    ],
  },
  {
    label: "Other",
    options: ["One Size", "Unknown / label missing"],
  },
];
const SIZES = SIZE_GROUPS.flatMap(group => group.options);
const CONDITIONS = ["Like New", "Good", "Fair", "Well Loved"];
const EQUIPMENT_TYPES = [
  "Dobok",
  "Body Armour",
  "Belt",
  "Paddles / Training Aids",
  "T-Shirts & Hoodies",
  "Other Clothing",
  "Other",
];
const PROTECTIVE_EQUIPMENT_TYPES = new Set([
  "Body Armour",
  "Helmet",
  "Head Guard",
  "Headguard",
  "Sparring Gloves",
  "Gloves",
  "Foot Protectors",
  "Foot Guards",
  "Shin Guards",
  "Forearm Guards",
  "Chest Guard",
  "Chest Protector",
]);

function normaliseEquipmentType(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return PROTECTIVE_EQUIPMENT_TYPES.has(clean) ? "Body Armour" : clean;
}
const SORT_OPTIONS = [
  { value: "newest", label: "Newest to Oldest" },
  { value: "oldest", label: "Oldest to Newest" },
  { value: "priceHigh", label: "Price: High to Low" },
  { value: "priceLow", label: "Price: Low to High" },
  { value: "titleAsc", label: "Title: A to Z" },
];


const LISTINGS_STORAGE_KEY = "tkd-listings";
const ADMIN_SESSION_KEY = "tkd-admin-verified";

// This fallback hash is only used if Supabase is not configured.
// With Supabase enabled, the admin password is checked by database functions.
// Do not put the plain admin password in this file.
const ADMIN_PASSWORD_HASH = "";
const ADMIN_PASSWORD_SESSION_KEY = "tkd-admin-password-session";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1200;
const IMAGE_JPEG_QUALITY = 0.82;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CODE_LENGTH = 8;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? gbp.format(price) : "£0.00";
}

function formatDateShort(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function renderSizeOptions() {
  return SIZE_GROUPS.map(group => (
    <optgroup key={group.label} label={group.label}>
      {group.options.map(size => <option key={size} value={size}>{size}</option>)}
    </optgroup>
  ));
}

function getSellerCodeEmailDetails({ contactEmail, title, secretCode }) {
  const to = String(contactEmail || "").trim();
  if (!to) return null;

  const subject = `Your TKD kit listing code: ${title}`;
  const body = [
    "Hi,",
    "",
    `Your listing "${title}" is now live on the Phoenix TKD kit marketplace.`,
    "",
    `Your seller code is: ${secretCode}`,
    "",
    "Keep this code safe. You will need it to edit your listing or mark the item as sold.",
    "",
    "How to edit or remove your listing:",
    "1. Open the marketplace.",
    "2. Click your listing card.",
    "3. Scroll to the owner section.",
    "4. Enter this seller code.",
    "5. Choose Edit Listing or Mark as Sold.",
    "",
    "Housekeeping reminder: please remove the listing once your item has sold, including if it sells elsewhere.",
    "",
    "Thanks for helping the club reuse kit.",
  ].join("\n");

  return { to, subject, body };
}

function buildSellerCodeMailto(submitted) {
  const email = getSellerCodeEmailDetails(submitted);
  if (!email) return "";

  // Keep the email address itself human-readable. Some email clients do not like an encoded recipient.
  return `mailto:${email.to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
}

function getSellerCodeReminderText(submitted) {
  const email = getSellerCodeEmailDetails(submitted);
  if (!email) return `Seller code: ${submitted?.secretCode || ""}`;

  return `${email.subject}\n\n${email.body}`;
}

async function copyTextToClipboard(text) {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the older textarea method below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function getListingTimestamp(item) {
  const value = item?.listedAt || item?.createdAt || item?.created_at || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareNewestFirst(a, b) {
  return getListingTimestamp(b) - getListingTimestamp(a);
}

function sortListings(items, sortOrder) {
  const sorted = [...items];

  switch (sortOrder) {
    case "oldest":
      return sorted.sort((a, b) => getListingTimestamp(a) - getListingTimestamp(b));
    case "priceHigh":
      return sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0) || compareNewestFirst(a, b));
    case "priceLow":
      return sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0) || compareNewestFirst(a, b));
    case "titleAsc":
      return sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "en-GB", { sensitivity: "base" }) || compareNewestFirst(a, b));
    case "newest":
    default:
      return sorted.sort(compareNewestFirst);
  }
}

function normaliseCode(value) {
  return String(value || "").trim().toUpperCase();
}

function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateCode(length = CODE_LENGTH) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, value => chars[value % chars.length]).join("");
  }

  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure hashing is unavailable. Use HTTPS or localhost.");
  }

  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyRemoteAdminPassword(password) {
  return Boolean(await supabaseRpc("verify_admin_password", {
    admin_password: normaliseCode(password),
  }));
}

async function verifyAdminPassword(password) {
  const cleanPassword = normaliseCode(password);

  if (!cleanPassword) {
    return { ok: false, error: "Please enter the admin password." };
  }

  if (SUPABASE_ENABLED) {
    try {
      const ok = await verifyRemoteAdminPassword(cleanPassword);
      return {
        ok,
        error: ok ? "" : "Incorrect password, or the admin password has not been set in Supabase.",
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not verify the admin password with Supabase.",
      };
    }
  }

  if (!ADMIN_PASSWORD_HASH) {
    return {
      ok: false,
      error: "Admin login is not configured. Set ADMIN_PASSWORD_HASH or connect Supabase admin verification.",
    };
  }

  const hash = await sha256Hex(cleanPassword);
  return {
    ok: hash === ADMIN_PASSWORD_HASH,
    error: hash === ADMIN_PASSWORD_HASH ? "" : "Incorrect password.",
  };
}

async function verifySellerCode(input, item) {
  const normalised = normaliseCode(input);
  if (!normalised) return false;

  if (SUPABASE_ENABLED) {
    return verifyRemoteSellerCode(item.id, normalised);
  }

  if (item.secretCodeHash) {
    return (await sha256Hex(normalised)) === item.secretCodeHash;
  }

  // Legacy support for listings created before secret-code hashing was added.
  return normalised === normaliseCode(item.secretCode);
}


function getSupabaseUrl() {
  return SUPABASE_URL.replace(/\/$/, "");
}

async function supabaseRpc(functionName, body = {}) {
  if (!SUPABASE_ENABLED) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.");
  }

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Database request failed (${response.status})`;
    try {
      const error = await response.json();
      message = error?.message || error?.details || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function databaseRowToListing(row) {
  return normaliseListing({
    id: row.id,
    title: row.title || "",
    brand: row.brand || "",
    equipmentType: normaliseEquipmentType(row.equipment_type),
    size: row.size || "",
    color: row.color || "",
    condition: row.condition || "",
    price: Number(row.price) || 0,
    description: row.description || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactEmail: row.contact_email || "",
    images: Array.isArray(row.images) ? row.images : [],
    listedAt: row.listed_at || row.created_at || new Date().toISOString(),
  });
}

function listingToDatabasePayload(item) {
  return {
    title: item.title || "",
    brand: item.brand || "",
    equipmentType: normaliseEquipmentType(item.equipmentType),
    size: item.size || "",
    color: item.color || "",
    condition: item.condition || "",
    price: Number(item.price) || 0,
    description: item.description || "",
    contactName: item.contactName || "",
    contactPhone: item.contactPhone || "",
    contactEmail: item.contactEmail || "",
    images: Array.isArray(item.images) ? item.images : [],
    listedAt: item.listedAt || new Date().toISOString(),
  };
}

async function createRemoteListing(item) {
  const rows = await supabaseRpc("create_listing", {
    listing_data: listingToDatabasePayload(item),
    seller_code_hash: item.secretCodeHash,
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error("The database did not return the new listing.");
  return databaseRowToListing(row);
}

async function updateRemoteListing(item, sellerCode) {
  const rows = await supabaseRpc("update_listing", {
    listing_id: item.id,
    seller_code: normaliseCode(sellerCode),
    listing_data: listingToDatabasePayload(item),
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error("Incorrect seller code, or this listing no longer exists.");
  return databaseRowToListing(row);
}

async function deleteRemoteListing(id, sellerCode) {
  const deleted = await supabaseRpc("delete_listing", {
    listing_id: id,
    seller_code: normaliseCode(sellerCode),
  });

  if (!deleted) throw new Error("Incorrect seller code, or this listing no longer exists.");
}

async function adminDeleteRemoteListing(id) {
  const adminPassword = normaliseCode(window.sessionStorage?.getItem(ADMIN_PASSWORD_SESSION_KEY) || "");
  if (!adminPassword) throw new Error("Admin session expired. Please log in again.");

  const deleted = await supabaseRpc("admin_delete_listing", {
    listing_id: id,
    admin_password: adminPassword,
  });

  if (!deleted) {
    window.sessionStorage?.removeItem(ADMIN_SESSION_KEY);
    window.sessionStorage?.removeItem(ADMIN_PASSWORD_SESSION_KEY);
    throw new Error("Admin delete was rejected. Log out, log back in, and check that the admin password is set in Supabase.");
  }
}

async function verifyRemoteSellerCode(id, sellerCode) {
  return Boolean(await supabaseRpc("verify_listing_code", {
    listing_id: id,
    seller_code: normaliseCode(sellerCode),
  }));
}

function normaliseListing(listing) {
  return {
    ...listing,
    id: listing.id || generateId(),
    equipmentType: normaliseEquipmentType(listing.equipmentType),
    price: Number(listing.price) || 0,
    images: Array.isArray(listing.images) ? listing.images : [],
    listedAt: listing.listedAt || new Date().toISOString(),
  };
}

function parseListings(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normaliseListing) : [];
  } catch (error) {
    console.error("Could not parse saved listings", error);
    return [];
  }
}

async function loadListings() {
  if (typeof window === "undefined") return [];

  if (SUPABASE_ENABLED) {
    const rows = await supabaseRpc("get_listings");
    return Array.isArray(rows) ? rows.map(databaseRowToListing) : [];
  }

  if (window.storage?.get) {
    const result = await window.storage.get(LISTINGS_STORAGE_KEY);
    return parseListings(result?.value ?? result);
  }

  return parseListings(window.localStorage?.getItem(LISTINGS_STORAGE_KEY));
}

async function saveListings(listings) {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify(listings.map(normaliseListing));

  if (window.storage?.set) {
    await window.storage.set(LISTINGS_STORAGE_KEY, payload);
    return;
  }

  if (!window.localStorage) {
    throw new Error("No browser storage API is available.");
  }

  window.localStorage.setItem(LISTINGS_STORAGE_KEY, payload);
}

function getStorageErrorMessage(error) {
  console.error("Listing storage failed", error);

  if (error?.name === "QuotaExceededError") {
    return "Could not save because browser storage is full. Try removing some photos or using smaller images.";
  }

  return error?.message || "Could not save your changes. Please try again.";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function readOptimisedImageAsDataUrl(file) {
  const originalDataUrl = await readFileAsDataUrl(file);

  if (typeof Image === "undefined" || typeof document === "undefined") {
    return originalDataUrl;
  }

  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        resolve(originalDataUrl);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY));
    };

    image.onerror = () => resolve(originalDataUrl);
    image.src = originalDataUrl;
  });
}

function useImageUpload(initialImages = []) {
  const [images, setImages] = useState(initialImages);
  const [imageError, setImageError] = useState("");
  const fileRef = useRef(null);

  const resetFileInput = () => {
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const slotsLeft = MAX_IMAGES - images.length;
    if (slotsLeft <= 0) {
      setImageError(`You can upload up to ${MAX_IMAGES} photos.`);
      resetFileInput();
      return;
    }

    const validFiles = incoming.filter(file => {
      return ACCEPTED_IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_SIZE_BYTES;
    });
    const selectedFiles = validFiles.slice(0, slotsLeft);
    const rejectedCount = incoming.length - selectedFiles.length;

    if (!selectedFiles.length) {
      setImageError(`Please choose JPG, PNG, or WEBP images under ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB each.`);
      resetFileInput();
      return;
    }

    try {
      const newImages = await Promise.all(selectedFiles.map(readOptimisedImageAsDataUrl));
      setImages(prev => [...prev, ...newImages].slice(0, MAX_IMAGES));
      setImageError(
        rejectedCount > 0
          ? `Added ${selectedFiles.length} photo${selectedFiles.length === 1 ? "" : "s"}. Some files were skipped because they were invalid, too large, or over the ${MAX_IMAGES}-photo limit.`
          : ""
      );
    } catch (error) {
      console.error("Image upload failed", error);
      setImageError("Could not read one or more photos. Please try again.");
    } finally {
      resetFileInput();
    }
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, currentIndex) => currentIndex !== index));
    setImageError("");
  };

  return { images, setImages, imageError, setImageError, fileRef, handleFiles, removeImage };
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900&display=swap');

  :root {
    --ink: #07111f;
    --ink-soft: #243447;
    --muted: #53657d;
    --faint: #8190a5;
    --line: #d7e0ec;
    --surface: #ffffff;
    --surface-soft: #edf3fb;
    --surface-blue: #e0edff;
    --primary: #0648a8;
    --primary-dark: #032f73;
    --primary-soft: rgba(6,72,168,0.12);
    --primary-line: rgba(6,72,168,0.28);
    --success: #14713a;
    --warning: #a65a08;
    --danger: #c91f2d;
    --shadow-sm: 0 9px 24px rgba(7,17,31,0.11);
    --shadow-md: 0 18px 44px rgba(7,17,31,0.16);
    --radius: 22px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }

  body {
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(6,72,168,0.18), transparent 34rem),
      radial-gradient(circle at bottom right, rgba(3,47,115,0.10), transparent 32rem),
      linear-gradient(180deg, #f4f7fc 0%, #eaf1fa 44%, #dfe9f5 100%);
    color: var(--ink);
    font-family: 'Barlow', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .app { min-height: 100vh; display: flex; flex-direction: column; }

  /* NAV */
  .nav {
    background: rgba(247,250,255,0.94);
    border-bottom: 1px solid rgba(187,199,216,0.82);
    backdrop-filter: blur(16px);
    padding: 0 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 72px;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 8px 30px rgba(15,23,42,0.06);
  }
  .nav-logo {
    font-weight: 900;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .nav-logo > span {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 14px;
    background: linear-gradient(135deg, var(--primary), #1d7cf2);
    box-shadow: 0 10px 22px rgba(6,72,168,0.22);
  }
  .nav-logo span { color: var(--primary); }
  .nav-tabs { display: flex; gap: 8px; align-items: center; }
  .nav-tab {
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    font-family: inherit;
    font-size: 14px;
    font-weight: 800;
    padding: 10px 16px;
    cursor: pointer;
    border-radius: 999px;
    transition: all 0.16s ease;
  }
  .nav-tab:hover { color: var(--primary); background: var(--primary-soft); }
  .nav-tab.active {
    color: #fff;
    background: var(--primary);
    border-color: var(--primary);
    box-shadow: 0 10px 22px rgba(6,72,168,0.22);
  }
  .badge {
    background: var(--primary);
    color: #fff;
    font-size: 11px;
    font-weight: 900;
    padding: 3px 8px;
    border-radius: 999px;
    margin-left: 8px;
  }
  .nav-tab.active .badge { background: rgba(255,255,255,0.22); }

  /* HERO */
  .hero {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(90deg, rgba(248,251,255,0.99) 0%, rgba(244,248,253,0.93) 42%, rgba(213,228,247,0.94) 100%),
      radial-gradient(circle at 80% 20%, rgba(6,72,168,0.22), transparent 28rem);
    border-bottom: 1px solid var(--line);
  }
  .hero::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(120deg, transparent 0 58%, rgba(6,72,168,0.08) 58% 100%),
      radial-gradient(circle at 100% 0%, rgba(6,72,168,0.12), transparent 22rem);
    pointer-events: none;
  }
  .hero-inner {
    position: relative;
    max-width: 1340px;
    min-height: 500px;
    margin: 0 auto;
    padding: 56px 42px 50px;
    display: grid;
    grid-template-columns: minmax(340px, 0.9fr) minmax(440px, 1.1fr);
    gap: 34px;
    align-items: center;
  }
  .hero-copy { position: relative; z-index: 2; }
  .hero-kicker {
    display: inline-flex;
    text-decoration: none;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 7px 12px;
    border: 1px solid var(--primary-line);
    border-radius: 999px;
    background: rgba(255,255,255,0.80);
    color: var(--primary);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hero-kicker::before { content: "★"; font-size: 12px; }
  .hero h1 {
    font-size: clamp(44px, 5.9vw, 82px);
    font-weight: 900;
    letter-spacing: -0.055em;
    line-height: 0.92;
    color: var(--ink);
  }
  .hero h1 span { color: var(--primary); }
  .hero-sub {
    margin-top: 24px;
    color: var(--ink-soft);
    font-size: clamp(18px, 1.8vw, 22px);
    font-weight: 500;
    max-width: 620px;
    line-height: 1.45;
  }
  .hero-actions {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 30px;
  }
  .hero-actions .btn {
    min-height: 58px;
    padding-inline: 28px;
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
    font-size: 17px;
    text-transform: none;
  }
  .hero-trust-row {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-top: 30px;
    color: var(--ink-soft);
    font-size: 15px;
    font-weight: 600;
  }
  .hero-trust-row span { display: inline-flex; align-items: center; gap: 8px; }

  .hero-visual {
    position: relative;
    min-height: 390px;
    border-radius: 34px;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.18)),
      linear-gradient(0deg, #eadfce 0%, #f8f4ec 44%, rgba(255,255,255,0) 45%);
    overflow: hidden;
  }
  .hero-visual::after {
    content: "";
    position: absolute;
    inset: auto -6% 0 -6%;
    height: 44%;
    background: linear-gradient(90deg, rgba(222,206,181,0.22), rgba(234,223,206,0.72), rgba(222,206,181,0.26));
    border-radius: 50% 50% 0 0;
  }
  .hero-kit-image {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    filter: saturate(1.02) contrast(1.01);
  }
  .gear-stage {
    position: absolute;
    inset: 0;
    z-index: 1;
  }
  .dobok-piece {
    position: absolute;
    left: 7%;
    top: 5%;
    width: 47%;
    height: 58%;
    border-radius: 24px 24px 18px 18px;
    background:
      linear-gradient(145deg, #fff 0%, #f6f7fb 58%, #e8edf5 100%);
    box-shadow: 0 28px 48px rgba(15,23,42,0.18), inset 0 0 0 1px rgba(15,23,42,0.06);
    transform: rotate(6deg);
  }
  .dobok-piece::before,
  .dobok-piece::after {
    content: "";
    position: absolute;
    top: 11%;
    height: 75%;
    width: 12px;
    background: linear-gradient(180deg, #fff, #dbe4ef);
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(15,23,42,0.04);
  }
  .dobok-piece::before { left: 44%; transform: rotate(28deg); }
  .dobok-piece::after { left: 53%; transform: rotate(-28deg); }
  .dobok-neck {
    position: absolute;
    left: 43%;
    top: 6%;
    width: 17%;
    height: 38%;
    background: #f8fafc;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    filter: drop-shadow(0 1px 1px rgba(15,23,42,0.10));
  }
  .dobok-brand {
    position: absolute;
    left: 13%;
    bottom: 22%;
    color: #111827;
    font-weight: 900;
    letter-spacing: 0.12em;
    font-size: 20px;
    text-transform: uppercase;
  }
  .dobok-brand small {
    display: block;
    margin-top: 2px;
    font-size: 8px;
    letter-spacing: 0.22em;
    color: #475569;
  }
  .helmet-piece {
    position: absolute;
    right: 18%;
    top: 8%;
    width: 24%;
    height: 31%;
    border-radius: 38% 46% 46% 38%;
    background: linear-gradient(135deg, #0648a8, #053b8f);
    box-shadow: 0 26px 38px rgba(6,72,168,0.24), inset -12px -10px 26px rgba(0,0,0,0.16);
    transform: rotate(9deg);
  }
  .helmet-piece::after {
    content: "";
    position: absolute;
    left: 26%;
    top: 31%;
    width: 44%;
    height: 42%;
    border-radius: 999px;
    background: #06152a;
    box-shadow: inset 0 0 0 7px rgba(255,255,255,0.10);
  }
  .helmet-hole {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.78);
    box-shadow: 28px 8px 0 rgba(255,255,255,0.70), 10px 37px 0 rgba(255,255,255,0.56);
    left: 18px;
    top: 22px;
  }
  .helmet-brand {
    position: absolute;
    left: 43%;
    top: 14%;
    transform: translateX(-50%);
    color: #fff;
    font-weight: 900;
    font-size: 12px;
    letter-spacing: 0.03em;
  }
  .armour-piece {
    position: absolute;
    right: -1%;
    top: 22%;
    width: 35%;
    height: 50%;
    border-radius: 36px 36px 22px 22px;
    background:
      linear-gradient(90deg, transparent 0 10%, rgba(255,255,255,0.16) 10% 12%, transparent 12% 100%),
      repeating-linear-gradient(90deg, transparent 0 18%, rgba(255,255,255,0.12) 18% 19%, transparent 19% 28%),
      linear-gradient(145deg, #1f72db, #06439c);
    box-shadow: 0 24px 44px rgba(6,72,168,0.28), inset 0 0 0 2px rgba(255,255,255,0.18);
    transform: rotate(4deg);
  }
  .armour-piece::before {
    content: "";
    position: absolute;
    left: 29%;
    top: -3%;
    width: 42%;
    height: 20%;
    border-radius: 0 0 999px 999px;
    background: #f8fafc;
  }
  .armour-brand {
    position: absolute;
    left: 50%;
    top: 22%;
    transform: translateX(-50%);
    color: #fff;
    font-weight: 900;
    font-size: 17px;
    letter-spacing: 0.02em;
  }
  .armour-number {
    position: absolute;
    left: 50%;
    bottom: 18%;
    transform: translateX(-50%);
    color: rgba(255,255,255,0.82);
    font-weight: 900;
    font-size: 28px;
  }
  .hero-belt {
    position: absolute;
    left: 17%;
    bottom: 18%;
    width: 48%;
    height: 28px;
    border-radius: 999px;
    background: linear-gradient(180deg, #1c73dc, #073e98);
    box-shadow: 0 22px 26px rgba(6,72,168,0.25), inset 0 6px 0 rgba(255,255,255,0.15);
    transform: rotate(-5deg);
  }
  .hero-belt::before,
  .hero-belt::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 42%;
    height: 28px;
    border-radius: 999px;
    background: inherit;
    transform-origin: center;
  }
  .hero-belt::before { left: 3%; transform: translateY(-50%) rotate(26deg); }
  .hero-belt::after { right: 1%; transform: translateY(-50%) rotate(-24deg); }
  .belt-knot {
    position: absolute;
    z-index: 2;
    left: 45%;
    top: -9px;
    width: 54px;
    height: 46px;
    border-radius: 14px;
    background: linear-gradient(135deg, #207ce8, #043a90);
    box-shadow: inset 0 3px 0 rgba(255,255,255,0.16), 0 10px 18px rgba(6,72,168,0.20);
  }
  .glove-piece {
    position: absolute;
    right: 23%;
    bottom: 13%;
    width: 21%;
    height: 17%;
    border-radius: 18px 24px 24px 18px;
    background: linear-gradient(145deg, #fff, #e9eef6);
    box-shadow: 0 18px 28px rgba(15,23,42,0.15), inset -5px -4px 0 rgba(15,23,42,0.04);
    transform: rotate(-12deg);
  }
  .glove-piece::before {
    content: "";
    position: absolute;
    left: 16%;
    top: 14%;
    width: 70%;
    height: 35%;
    border-radius: 999px;
    background: linear-gradient(90deg, transparent, rgba(15,23,42,0.12));
    opacity: 0.38;
  }
  .glove-brand {
    position: absolute;
    right: 12%;
    bottom: 14%;
    color: #0f172a;
    font-weight: 900;
    font-size: 10px;
    transform: rotate(2deg);
  }

  /* STORE GRID */
  .store-section {
    width: 100%;
    max-width: 1320px;
    margin: 0 auto;
    padding: 28px 42px 64px;
  }
  .store-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 24px;
    padding: 18px 22px;
    background: rgba(250,252,255,0.94);
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: var(--shadow-sm);
  }
  .store-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink);
    font-size: 18px;
    font-weight: 900;
  }
  .store-title::before { content: "↕"; color: var(--primary); font-size: 18px; }
  .filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .filter-btn {
    background: #fff;
    border: 1px solid var(--line);
    color: var(--muted);
    font-family: inherit;
    font-size: 13px;
    font-weight: 800;
    padding: 8px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.16s ease;
  }
  .filter-btn:hover { color: var(--primary); border-color: var(--primary-line); background: var(--primary-soft); }
  .filter-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
  .store-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .sort-control {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-size: 15px;
    font-weight: 900;
  }
  .sort-select {
    appearance: none;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    cursor: pointer;
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    min-width: 210px;
    outline: none;
    padding: 10px 38px 10px 14px;
    box-shadow: 0 4px 10px rgba(15,23,42,0.04);
    background-image: linear-gradient(45deg, transparent 50%, var(--primary) 50%), linear-gradient(135deg, var(--primary) 50%, transparent 50%);
    background-position: calc(100% - 18px) 52%, calc(100% - 12px) 52%;
    background-size: 6px 6px, 6px 6px;
    background-repeat: no-repeat;
  }
  .sort-select:focus,
  .search-bar:focus,
  .form-input:focus,
  .form-select:focus,
  .form-textarea:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 4px rgba(6,72,168,0.11);
  }
  .store-note {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 18px;
    padding: 14px 16px;
    border: 1px solid var(--primary-line);
    border-radius: 14px;
    background: linear-gradient(90deg, rgba(6,72,168,0.08), rgba(255,255,255,0.88));
    color: var(--ink-soft);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.45;
  }
  .store-note strong { color: var(--primary); }
  .search-bar-wrap { position: relative; width: 100%; margin-bottom: 22px; }
  .search-bar-icon {
    position: absolute;
    left: 15px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--faint);
    font-size: 16px;
    pointer-events: none;
  }
  .search-bar {
    width: 100%;
    background: rgba(255,255,255,0.96);
    border: 1px solid var(--line);
    border-radius: 15px;
    color: var(--ink);
    font-family: inherit;
    font-size: 16px;
    padding: 14px 44px 14px 44px;
    outline: none;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
    box-shadow: 0 8px 22px rgba(15,23,42,0.05);
  }
  .search-bar::placeholder { color: var(--faint); }
  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--surface-soft);
    border: 1px solid var(--line);
    color: var(--muted);
    width: 28px;
    height: 28px;
    border-radius: 999px;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.16s ease;
  }
  .search-clear:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
  .search-results-info { font-size: 14px; color: var(--muted); margin-bottom: 16px; }
  .search-results-info strong { color: var(--primary); }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(286px, 1fr)); gap: 22px; }

  .card {
    width: 100%;
    position: relative;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 18px;
    overflow: hidden;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    box-shadow: 0 10px 24px rgba(15,23,42,0.08);
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    appearance: none;
  }
  .card:hover { transform: translateY(-5px); border-color: var(--primary-line); box-shadow: 0 22px 46px rgba(15,23,42,0.14); }
  .card:focus-visible { outline: 4px solid rgba(6,72,168,0.18); outline-offset: 3px; }
  .card::before { content: none; }
  .card-img {
    width: 100%;
    height: 220px;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0)),
      linear-gradient(0deg, #eadfce 0%, #f8f4ec 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #cbd5e1;
    font-size: 48px;
    font-weight: 900;
    position: relative;
    padding: 12px;
  }
  .card-img img { width: 100%; height: 100%; object-fit: contain; object-position: center; border-radius: 12px; }
  .card-view-pill {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    background: #fff;
    border: 1px solid rgba(15,23,42,0.10);
    color: var(--ink);
    border-radius: 12px;
    padding: 8px 11px;
    font-size: 13px;
    font-weight: 900;
    box-shadow: 0 8px 18px rgba(15,23,42,0.12);
    pointer-events: none;
  }
  .card-view-pill::before { content: "👁 "; font-size: 12px; }
  .card-photo-count,
  .modal-photo-count {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 3;
    background: rgba(15,23,42,0.72);
    border: 1px solid rgba(255,255,255,0.15);
    color: #fff;
    border-radius: 10px;
    padding: 5px 9px;
    font-size: 12px;
    font-weight: 800;
    backdrop-filter: blur(6px);
  }
  .card-photo-nav,
  .modal-photo-nav {
    position: absolute;
    top: 50%;
    z-index: 4;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid rgba(15,23,42,0.10);
    background: rgba(255,255,255,0.92);
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    line-height: 1;
    font-weight: 800;
    cursor: pointer;
    transform: translateY(-50%);
    transition: all 0.16s ease;
    box-shadow: 0 8px 18px rgba(15,23,42,0.14);
    padding: 0 0 3px;
  }
  .card-photo-prev, .modal-photo-prev { left: 12px; }
  .card-photo-next, .modal-photo-next { right: 12px; }
  .card-photo-nav:hover,
  .card-photo-nav:focus-visible,
  .modal-photo-nav:hover,
  .modal-photo-nav:focus-visible {
    background: var(--primary);
    color: #fff;
    border-color: var(--primary);
    outline: none;
  }
  .card-body { padding: 16px; }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .card-name { font-weight: 900; font-size: 19px; line-height: 1.18; color: var(--ink); }
  .card-price { color: var(--ink); font-size: 25px; font-weight: 900; white-space: nowrap; }
  .card-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .tag {
    font-size: 12px;
    font-weight: 800;
    padding: 5px 9px;
    border-radius: 999px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .tag.condition-new { background: rgba(22,163,74,0.10); border-color: rgba(22,163,74,0.22); color: #15803d; }
  .tag.condition-good { background: var(--primary-soft); border-color: var(--primary-line); color: var(--primary); }
  .tag.condition-fair { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.28); color: #b45309; }
  .tag.condition-loved { background: rgba(100,116,139,0.12); border-color: rgba(100,116,139,0.22); color: #475569; }
  .card-desc {
    margin-top: 10px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-listed { margin-top: 10px; color: var(--faint); font-size: 13px; }
  .card-seller-box {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: linear-gradient(180deg, #fff, #f8fafc);
    color: var(--muted);
    display: grid;
    grid-template-columns: 38px 1fr;
    gap: 10px;
    align-items: center;
  }
  .card-seller-box::before {
    content: "👤";
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-soft);
  }
  .card-seller-label { display: block; color: var(--muted); font-size: 12px; font-weight: 600; margin-bottom: 2px; }
  .card-seller-box strong { color: var(--ink); display: block; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .empty-state { grid-column: 1/-1; text-align: center; padding: 70px 20px; color: var(--muted); }
  .empty-state .icon { font-size: 56px; }
  .empty-state p { margin-top: 12px; font-size: 16px; }

  /* MODAL */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(15,23,42,0.55);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(7px);
  }
  .modal {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 22px;
    width: 100%;
    max-width: 650px;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    box-shadow: 0 32px 80px rgba(15,23,42,0.30);
  }
  .modal-close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 5;
    background: #fff;
    border: 1px solid var(--line);
    color: var(--muted);
    width: 38px;
    height: 38px;
    border-radius: 999px;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.16s ease;
    box-shadow: 0 8px 18px rgba(15,23,42,0.10);
  }
  .modal-close:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
  .modal-img {
    width: 100%;
    min-height: 300px;
    height: min(64vh, 540px);
    background: linear-gradient(0deg, #eadfce 0%, #f8f4ec 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 72px;
    color: #cbd5e1;
    border-radius: 22px 22px 0 0;
    overflow: hidden;
    padding: 16px;
    position: relative;
  }
  .modal-img img { width: 100%; height: 100%; object-fit: contain; border-radius: 14px; }
  .modal-body { padding: 26px; }
  .modal-title { font-weight: 900; font-size: 32px; line-height: 1.1; color: var(--ink); }
  .modal-price { font-weight: 900; font-size: 34px; color: var(--primary); margin-top: 6px; }
  .modal-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; }
  .modal-desc { margin-top: 18px; color: var(--ink-soft); font-size: 16px; line-height: 1.6; }
  .modal-section { margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--line); }
  .modal-section-title { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.10em; color: var(--primary); margin-bottom: 12px; }
  .contact-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .contact-chip {
    background: var(--surface-soft);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 14px;
    font-size: 15px;
    color: var(--ink);
  }
  .contact-chip small { display: block; font-size: 11px; color: var(--muted); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.06em; }
  .sold-section, .owner-actions {
    margin-top: 20px;
    padding: 16px;
    background: var(--surface-blue);
    border: 1px solid var(--primary-line);
    border-radius: 14px;
  }
  .sold-section p { font-size: 14px; color: var(--ink-soft); margin-bottom: 12px; }
  .sold-row { display: flex; gap: 8px; }
  .owner-actions-title { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: var(--primary); margin-bottom: 12px; }
  .owner-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }

  /* FORMS / PAGE SECTIONS */
  .form-section,
  .tc-section,
  .admin-section {
    width: min(100% - 40px, 760px);
    margin: 42px auto 72px;
    padding: 30px;
    background: rgba(255,255,255,0.94);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }
  .admin-section { width: min(100% - 40px, 1080px); }
  .form-section::before,
  .tc-section::before,
  .admin-section::before {
    content: "";
    display: block;
    height: 5px;
    margin: -30px -30px 26px;
    border-radius: var(--radius) var(--radius) 0 0;
    background: linear-gradient(90deg, var(--primary), #3b82f6);
  }
  .form-title, .admin-title, .tc-title, .edit-modal-title {
    color: var(--ink);
    font-size: clamp(28px, 4vw, 38px);
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
  }
  .form-sub, .admin-sub, .tc-subtitle, .edit-modal-sub { color: var(--muted); font-size: 15px; margin-bottom: 28px; line-height: 1.55; }
  .form-group { margin-bottom: 20px; }
  .form-label { display: block; font-size: 12px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
  .form-label .req { color: var(--danger); margin-left: 3px; }
  .form-hint { margin-top: 7px; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .field-note { margin-top: -8px; margin-bottom: 16px; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .contact-note { background: var(--surface-blue); border: 1px solid var(--primary-line); color: var(--primary-dark); border-radius: 14px; padding: 12px 14px; margin: -2px 0 16px; font-size: 14px; line-height: 1.45; }
  .form-input, .form-select, .form-textarea {
    width: 100%;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 12px;
    color: var(--ink);
    font-family: inherit;
    font-size: 16px;
    padding: 13px 14px;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
    outline: none;
    appearance: none;
  }
  .form-input::placeholder, .form-textarea::placeholder { color: var(--faint); }
  .form-textarea { min-height: 104px; resize: vertical; line-height: 1.5; }
  .form-select { cursor: pointer; background-image: linear-gradient(45deg, transparent 50%, var(--primary) 50%), linear-gradient(135deg, var(--primary) 50%, transparent 50%); background-position: calc(100% - 18px) 52%, calc(100% - 12px) 52%; background-size: 6px 6px, 6px 6px; background-repeat: no-repeat; padding-right: 38px; }
  .form-select option, .form-select optgroup { background: #fff; color: var(--ink); }
  .form-select optgroup { font-weight: 900; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .upload-area {
    border: 2px dashed #cbd5e1;
    border-radius: 16px;
    padding: 34px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.16s ease;
    background: var(--surface-soft);
    position: relative;
  }
  .upload-area:hover, .upload-area.drag { border-color: var(--primary); background: var(--surface-blue); }
  .upload-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .upload-icon { font-size: 34px; margin-bottom: 8px; }
  .upload-text { color: var(--muted); font-size: 15px; }
  .upload-text strong { color: var(--primary); }
  .previews { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .preview-thumb { width: 78px; height: 78px; border-radius: 14px; object-fit: contain; background: #f8fafc; padding: 5px; border: 1px solid var(--line); }
  .preview-wrap { position: relative; display: inline-block; }
  .remove-img { position: absolute; top: -7px; right: -7px; background: var(--danger); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; }
  .secret-box { background: var(--surface-blue); border: 1px solid var(--primary-line); border-radius: 14px; padding: 16px; margin-top: 8px; }
  .secret-box p { font-size: 14px; color: var(--primary-dark); line-height: 1.55; }
  .secret-box p strong { display: block; margin-bottom: 4px; font-size: 15px; }

  /* BUTTONS */
  .btn {
    font-family: inherit;
    font-weight: 900;
    text-decoration: none;
    font-size: 15px;
    padding: 12px 22px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: all 0.16s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .btn-primary { background: var(--primary); color: #fff; box-shadow: 0 12px 22px rgba(6,72,168,0.20); }
  .btn-primary:hover { background: var(--primary-dark); transform: translateY(-1px); }
  .btn-primary:disabled { background: #bfdbfe; color: #eff6ff; cursor: not-allowed; box-shadow: none; }
  .btn-ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); box-shadow: 0 8px 18px rgba(15,23,42,0.06); }
  .btn-ghost:hover { background: var(--surface-blue); border-color: var(--primary-line); color: var(--primary); }
  .btn-danger { background: rgba(220,38,38,0.10); color: var(--danger); border: 1px solid rgba(220,38,38,0.24); }
  .btn-danger:hover { background: var(--danger); color: #fff; }
  .btn-warning { background: rgba(245,158,11,0.12); color: var(--warning); border: 1px solid rgba(245,158,11,0.28); }
  .btn-warning:hover { background: rgba(245,158,11,0.20); }
  .btn-sm { font-size: 13px; padding: 8px 14px; }
  .btn-full { width: 100%; }

  .error-msg { color: var(--danger); font-size: 14px; margin-top: 7px; }
  .info-msg { color: var(--primary); font-size: 14px; margin-top: 8px; line-height: 1.45; }
  .global-error { max-width: 900px; margin: 18px auto 0; padding: 13px 16px; border: 1px solid rgba(220,38,38,0.24); border-radius: 14px; background: rgba(220,38,38,0.08); color: var(--danger); font-size: 14px; }
  .success-banner { background: rgba(22,163,74,0.08); border: 1px solid rgba(22,163,74,0.22); border-radius: 18px; padding: 22px; text-align: center; margin-bottom: 24px; }
  .success-banner h3 { color: var(--success); font-size: 20px; margin-bottom: 8px; }
  .success-banner p { color: var(--muted); font-size: 15px; line-height: 1.5; }
  .success-banner .secret { margin-top: 14px; background: #fff; border: 1px dashed rgba(21,128,61,0.34); border-radius: 12px; padding: 12px 16px; font-family: monospace; font-size: 22px; letter-spacing: 0.15em; color: var(--success); font-weight: 900; }
  .success-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 16px; }
  .success-small-note { margin-top: 12px; font-size: 13px; color: var(--muted); line-height: 1.45; }

  /* ADMIN */
  .admin-login-box { max-width: 420px; background: #fff; border: 1px solid var(--line); border-radius: 22px; padding: 30px; margin: 60px auto; text-align: center; box-shadow: var(--shadow-sm); }
  .admin-login-box h2 { font-size: 26px; font-weight: 900; color: var(--ink); margin-bottom: 8px; }
  .admin-login-box p { font-size: 14px; color: var(--muted); margin-bottom: 20px; }
  .admin-stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 24px; }
  .admin-stat { background: linear-gradient(180deg, #fff, #f8fafc); border: 1px solid var(--line); border-radius: 16px; padding: 16px 20px; min-width: 140px; box-shadow: 0 8px 18px rgba(15,23,42,0.05); }
  .admin-stat-num { font-weight: 900; font-size: 36px; color: var(--primary); }
  .admin-stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 900; }
  .admin-table { width: 100%; border-collapse: separate; border-spacing: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
  .admin-table th { text-align: left; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 12px; background: var(--surface-soft); border-bottom: 1px solid var(--line); }
  .admin-table td { padding: 13px 12px; border-bottom: 1px solid var(--line); font-size: 14px; color: var(--ink-soft); vertical-align: middle; }
  .admin-table tr:last-child td { border-bottom: none; }
  .admin-table tr:hover td { background: #fbfdff; }
  .admin-table td small { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
  .admin-logout { float: right; }

  /* TERMS */
  .tc-clause { margin-bottom: 24px; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
  .tc-clause:last-child { margin-bottom: 0; }
  .tc-clause-num { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; color: var(--primary); margin-bottom: 6px; }
  .tc-clause-title { font-weight: 900; font-size: 21px; color: var(--ink); margin-bottom: 10px; }
  .tc-clause p { font-size: 15px; color: var(--ink-soft); line-height: 1.7; }
  .tc-clause p + p { margin-top: 8px; }
  .tc-contact-box { background: var(--surface-blue); border: 1px solid var(--primary-line); border-radius: 14px; padding: 16px; margin-top: 12px; font-size: 15px; color: var(--ink); }
  .tc-contact-box small { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }

  /* CHECKBOX */
  .checkbox-group { display: flex; align-items: flex-start; gap: 12px; padding: 16px; background: var(--surface-soft); border: 1px solid var(--line); border-radius: 14px; margin-bottom: 20px; }
  .checkbox-group input[type="checkbox"] { width: 19px; height: 19px; accent-color: var(--primary); flex-shrink: 0; margin-top: 2px; cursor: pointer; }
  .checkbox-group label { font-size: 14px; color: var(--ink-soft); line-height: 1.6; }
  .link-button, .footer-link { background: none; border: none; color: var(--primary); text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
  .link-button:hover, .footer-link:hover { color: var(--primary-dark); }
  .checkbox-error { color: var(--danger); font-size: 14px; margin-top: -12px; margin-bottom: 16px; }

  /* FOOTER */
  .footer { margin-top: auto; background: #fff; border-top: 1px solid var(--line); padding: 30px 24px; text-align: center; }
  .footer-disclaimer { font-size: 13px; color: var(--muted); line-height: 1.7; max-width: 760px; margin: 0 auto; }
  .footer-disclaimer a { color: var(--primary); text-decoration: underline; }
  .footer-divider { width: 54px; height: 4px; background: linear-gradient(90deg, var(--primary), #60a5fa); border-radius: 999px; margin: 0 auto 18px; }

  @media (max-width: 980px) {
    .hero-inner { grid-template-columns: 1fr; padding: 42px 24px 34px; gap: 18px; }
    .hero-visual { min-height: 320px; }
    .store-section { padding: 24px 20px 56px; }
    .store-header { align-items: flex-start; flex-direction: column; }
    .store-controls { justify-content: flex-start; width: 100%; }
  }
  @media (max-width: 680px) {
    .nav { padding: 10px 14px; gap: 12px; align-items: flex-start; flex-direction: column; }
    .nav-tabs { width: 100%; flex-wrap: wrap; }
    .nav-tab { font-size: 13px; padding: 9px 12px; }
    .hero-inner { padding: 34px 18px 28px; }
    .hero h1 { font-size: 44px; }
    .hero-sub { font-size: 17px; }
    .hero-actions .btn { width: 100%; min-height: 52px; }
    .hero-trust-row { gap: 12px; font-size: 14px; }
    .hero-visual { min-height: 260px; border-radius: 24px; }
    .helmet-piece { right: 16%; width: 24%; }
    .armour-piece { width: 34%; }
    .glove-piece { right: 20%; width: 24%; }
    .store-header { padding: 15px; }
    .filter-row { width: 100%; }
    .filter-btn { flex: 1; }
    .sort-control { width: 100%; justify-content: space-between; }
    .sort-select { min-width: 0; flex: 1; }
    .grid { grid-template-columns: 1fr; }
    .card-img { height: 230px; }
    .form-section, .tc-section, .admin-section { width: calc(100% - 24px); margin: 24px auto 48px; padding: 22px; border-radius: 18px; }
    .form-section::before, .tc-section::before, .admin-section::before { margin: -22px -22px 22px; }
    .form-row { grid-template-columns: 1fr; gap: 0; }
    .sold-row { flex-direction: column; }
    .modal { border-radius: 18px; }
    .modal-img { min-height: 250px; height: 48vh; border-radius: 18px 18px 0 0; }
    .modal-body { padding: 20px; }
  }
`;


function conditionClass(c) {
  if (c === "Like New") return "condition-new";
  if (c === "Good") return "condition-good";
  if (c === "Well Loved") return "condition-loved";
  return "condition-fair";
}

function UniformCard({ item, onClick }) {
  const images = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
  const imageCount = images.length;
  const [cardImgIdx, setCardImgIdx] = useState(0);
  const listedDate = formatDateShort(item.listedAt);

  useEffect(() => {
    setCardImgIdx(0);
  }, [item.id, imageCount]);

  const openListing = () => onClick(item);

  const showPreviousCardPhoto = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCardImgIdx((idx) => (idx - 1 + imageCount) % imageCount);
  };

  const showNextCardPhoto = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCardImgIdx((idx) => (idx + 1) % imageCount);
  };

  const handleCardKeyDown = (event) => {
    const tagName = event.target?.tagName;
    if (["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openListing();
      return;
    }

    if (imageCount > 1 && event.key === "ArrowLeft") {
      showPreviousCardPhoto(event);
      return;
    }

    if (imageCount > 1 && event.key === "ArrowRight") {
      showNextCardPhoto(event);
    }
  };

  return (
    <article
      className="card"
      role="button"
      tabIndex={0}
      onClick={openListing}
      onKeyDown={handleCardKeyDown}
      aria-label={`View ${item.title}`}
    >
      <div className="card-img">
        <span className="card-view-pill">View →</span>
        {imageCount > 0 ? (
          <img src={images[cardImgIdx]} alt={`${item.title} photo ${cardImgIdx + 1}`} />
        ) : "🥋"}
        {imageCount > 1 && (
          <>
            <button
              className="card-photo-nav card-photo-prev"
              type="button"
              onClick={showPreviousCardPhoto}
              aria-label={`Previous photo for ${item.title}`}
            >
              {"\u2039"}
            </button>
            <button
              className="card-photo-nav card-photo-next"
              type="button"
              onClick={showNextCardPhoto}
              aria-label={`Next photo for ${item.title}`}
            >
              {"\u203A"}
            </button>
            <span className="card-photo-count">{cardImgIdx + 1} / {imageCount}</span>
          </>
        )}
      </div>
      <div className="card-body">
        <div className="card-top">
          <div className="card-name">{item.title}</div>
          <div className="card-price">{formatPrice(item.price)}</div>
        </div>
        <div className="card-tags">
          {item.equipmentType && <span className="tag" style={{ background: "rgba(6,72,168,0.12)", color: "#0648a8" }}>{item.equipmentType}</span>}
          {item.size && <span className="tag">{item.size}</span>}
          {item.color && <span className="tag">{item.color}</span>}
          {item.condition && <span className={`tag ${conditionClass(item.condition)}`}>{item.condition}</span>}
        </div>
        {item.description && <div className="card-desc">{item.description}</div>}
        {listedDate && <div className="card-listed">Listed {listedDate}</div>}
        <div className="card-seller-box">
          <span className="card-seller-label">Seller</span>
          <strong>{item.contactName || "Seller"}</strong>
        </div>
      </div>
    </article>
  );
}

function EditForm({ item, onSave, onCancel }) {
  const [form, setForm] = useState({
    title: item.title || "",
    brand: item.brand || "",
    equipmentType: normaliseEquipmentType(item.equipmentType),
    size: item.size || "",
    color: item.color || "",
    condition: item.condition || "",
    price: item.price || "",
    description: item.description || "",
    contactName: item.contactName || "",
    contactPhone: item.contactPhone || "",
    contactEmail: item.contactEmail || "",
  });
  const { images, imageError, fileRef, handleFiles, removeImage } = useImageUpload(item.images || []);
  const [errors, setErrors] = useState({});
  const [drag, setDrag] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Please enter a title";
    if (!form.size) e.size = "Please select a size";
    if (!form.condition) e.condition = "Please select a condition";
    if (!form.price || isNaN(form.price) || Number(form.price) <= 0) e.price = "Please enter a valid price";
    if (!form.contactName.trim()) e.contactName = "Your name is required";
    if (!form.contactPhone.trim() && !form.contactEmail.trim()) e.contactEmail = "Please provide at least one contact method: phone/WhatsApp or email";
    return e;
  };

  const handleSave = async (event) => {
    event?.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    setSaveError("");

    try {
      const updated = { ...item, ...form, price: Number(form.price), images };
      await onSave(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(getStorageErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="edit-modal-body" onSubmit={handleSave}>
      <div className="edit-modal-title">✏️ Edit Listing</div>
      <div className="edit-modal-sub">Update your listing details below. Your secret code stays the same.</div>

      <div className="form-group">
        <label className="form-label" htmlFor="edit-title">Title <span className="req">*</span></label>
        <input id="edit-title" className="form-input" value={form.title} onChange={e => set("title", e.target.value)} />
        {errors.title && <div className="error-msg">{errors.title}</div>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="edit-brand">Brand</label>
        <input id="edit-brand" className="form-input" placeholder="e.g. Adidas, Mooto, Daedo" value={form.brand} onChange={e => set("brand", e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="edit-equipment-type">Equipment Type</label>
        <select id="edit-equipment-type" className="form-select" value={form.equipmentType} onChange={e => set("equipmentType", e.target.value)}>
          <option value="">— Select —</option>
          {EQUIPMENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="form-hint">Choose Body Armour for protective kit such as chest guards, head guards, gloves, shin/forearm guards and foot protectors.</div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="edit-size">Size <span className="req">*</span></label>
          <select id="edit-size" className="form-select" value={form.size} onChange={e => set("size", e.target.value)}>
            <option value="">— Select —</option>
            {renderSizeOptions()}
          </select>
          {errors.size && <div className="error-msg">{errors.size}</div>}
          <div className="form-hint">For doboks, cm sizes refer to approximate wearer height.</div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="edit-color">Colour</label>
          <input id="edit-color" className="form-input" placeholder="e.g. white, blue, red, black" value={form.color} onChange={e => set("color", e.target.value)} />
          <div className="form-hint">Type the colour shown on the item label or in the photos.</div>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="edit-condition">Condition <span className="req">*</span></label>
          <select id="edit-condition" className="form-select" value={form.condition} onChange={e => set("condition", e.target.value)}>
            <option value="">— Select —</option>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
          {errors.condition && <div className="error-msg">{errors.condition}</div>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="edit-price">Price (£) <span className="req">*</span></label>
          <input id="edit-price" className="form-input" type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={e => set("price", e.target.value)} />
          {errors.price && <div className="error-msg">{errors.price}</div>}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="edit-description">Description</label>
        <textarea id="edit-description" className="form-textarea" value={form.description} onChange={e => set("description", e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Photos (up to {MAX_IMAGES})</label>
        <div
          className={`upload-area ${drag ? "drag" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => handleFiles(e.target.files)} aria-label="Upload listing photos" />
          <div className="upload-icon">📸</div>
          <div className="upload-text">Drag & drop or <strong>click to browse</strong><br /><span style={{ fontSize: 12 }}>JPG, PNG, WEBP — max {MAX_IMAGES} photos, 6MB each; resized automatically</span></div>
        </div>
        {imageError && <div className="info-msg">{imageError}</div>}
        {images.length > 0 && (
          <div className="previews">
            {images.map((src, i) => (
              <div className="preview-wrap" key={src.slice(0, 40) + i}>
                <img className="preview-thumb" src={src} alt={`Photo ${i + 1}`} />
                <button type="button" className="remove-img" onClick={() => removeImage(i)} aria-label={`Remove photo ${i + 1}`}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ paddingTop: 4, marginBottom: 4 }}>
        <div className="form-label" style={{ fontSize: 13, color: "#0648a8", marginBottom: 12 }}>Contact Details</div>
      </div>

      <div className="contact-note">You can provide phone/WhatsApp, email, or both. At least one contact method is required so buyers can reach you.</div>

      <div className="form-group">
        <label className="form-label" htmlFor="edit-contact-name">Name <span className="req">*</span></label>
        <input id="edit-contact-name" className="form-input" value={form.contactName} onChange={e => set("contactName", e.target.value)} />
        {errors.contactName && <div className="error-msg">{errors.contactName}</div>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="edit-contact-phone">Phone / WhatsApp</label>
          <input id="edit-contact-phone" className="form-input" type="tel" placeholder="07700 900000" value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="edit-contact-email">Email</label>
          <input id="edit-contact-email" className="form-input" type="email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} />
          {errors.contactEmail && <div className="error-msg">{errors.contactEmail}</div>}
        </div>
      </div>

      {saved && <div className="edit-updated-banner">✅ Listing updated successfully!</div>}
      {saveError && <div className="error-msg" role="alert" style={{ marginTop: 12 }}>{saveError}</div>}

      <div className="edit-save-row">
        <button className="btn btn-primary" style={{ flex: 1 }} type="submit" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DetailModal({ item, onClose, onSold, onEdit }) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [imgIdx, setImgIdx] = useState(0);
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentItem, setCurrentItem] = useState(item);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);

  const modalImages = Array.isArray(currentItem.images) ? currentItem.images : [];
  const hasImages = modalImages.length > 0;
  const hasMultipleImages = modalImages.length > 1;

  const showPreviousPhoto = (event) => {
    event?.stopPropagation();
    if (!hasMultipleImages) return;
    setImgIdx((idx) => (idx - 1 + modalImages.length) % modalImages.length);
  };

  const showNextPhoto = (event) => {
    event?.stopPropagation();
    if (!hasMultipleImages) return;
    setImgIdx((idx) => (idx + 1) % modalImages.length);
  };

  useEffect(() => {
    if (modalImages.length === 0 && imgIdx !== 0) {
      setImgIdx(0);
      return;
    }

    if (modalImages.length > 0 && imgIdx >= modalImages.length) {
      setImgIdx(0);
    }
  }, [imgIdx, modalImages.length]);

  useEffect(() => {
    if (!hasMultipleImages || editMode) return undefined;

    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setImgIdx((idx) => (idx - 1 + modalImages.length) % modalImages.length);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setImgIdx((idx) => (idx + 1) % modalImages.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, hasMultipleImages, modalImages.length]);

  const handleVerify = async () => {
    setVerifying(true);
    setCodeError("");

    try {
      if (await verifySellerCode(code, currentItem)) {
        setOwnerVerified(true);
      } else {
        setCodeError("Incorrect code. Please try again.");
      }
    } catch (error) {
      setCodeError(error.message || "Could not verify the code. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSold = async () => {
    setRemoving(true);
    setCodeError("");

    try {
      await onSold(currentItem.id, code);
      onClose();
    } catch (error) {
      setCodeError(getStorageErrorMessage(error));
      setRemoving(false);
    }
  };

  const handleSave = async (updated) => {
    const saved = await onEdit(updated, code);
    setCurrentItem(saved || updated);
  };

  if (editMode) {
    return (
      <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 600 }} role="dialog" aria-modal="true" aria-label="Edit listing">
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close listing editor">✕</button>
          <EditForm item={currentItem} onSave={handleSave} onCancel={() => setEditMode(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={currentItem.title}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close listing details">✕</button>
        <div className="modal-img">
          {hasImages ? (
            <>
              <img
                src={modalImages[imgIdx]}
                alt={`${currentItem.title} photo ${imgIdx + 1}`}
                style={{ cursor: hasMultipleImages ? "pointer" : "default" }}
                onClick={(event) => hasMultipleImages && showNextPhoto(event)}
              />
              {hasMultipleImages && (
                <>
                  <button
                    className="modal-photo-nav modal-photo-prev"
                    type="button"
                    onClick={showPreviousPhoto}
                    aria-label="Previous photo"
                  >
                    {"\u2039"}
                  </button>
                  <button
                    className="modal-photo-nav modal-photo-next"
                    type="button"
                    onClick={showNextPhoto}
                    aria-label="Next photo"
                  >
                    {"\u203A"}
                  </button>
                  <span className="modal-photo-count">{imgIdx + 1} / {modalImages.length}</span>
                </>
              )}
            </>
          ) : "🥋"}
        </div>
        {hasMultipleImages && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "8px 0 0", background: "#ffffff" }}>
            {modalImages.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`View photo ${i + 1}`}
                aria-current={i === imgIdx ? "true" : undefined}
                onClick={() => setImgIdx(i)}
                style={{
                  width: 8, height: 8, borderRadius: "50%", border: "none",
                  background: i === imgIdx ? "#0648a8" : "rgba(6,72,168,0.18)",
                  cursor: "pointer", padding: 0
                }}
              />
            ))}
          </div>
        )}
        <div className="modal-body">
          <div className="modal-title">{currentItem.title}</div>
          <div className="modal-price">{formatPrice(currentItem.price)}</div>
          <div className="modal-tags">
            {currentItem.equipmentType && <span className="tag" style={{ background: "rgba(6,72,168,0.12)", color: "#0648a8" }}>{currentItem.equipmentType}</span>}
            {currentItem.size && <span className="tag">{currentItem.size}</span>}
            {currentItem.color && <span className="tag">{currentItem.color}</span>}
            {currentItem.condition && <span className={`tag ${conditionClass(currentItem.condition)}`}>{currentItem.condition}</span>}
            {currentItem.brand && <span className="tag">{currentItem.brand}</span>}
          </div>
          {currentItem.description && <div className="modal-desc">{currentItem.description}</div>}

          <div className="modal-section">
            <div className="modal-section-title">Contact the Seller</div>
            <div className="contact-row">
              <div className="contact-chip">
                <small>Name</small>{currentItem.contactName}
              </div>
              {currentItem.contactPhone && (
                <div className="contact-chip">
                  <small>Phone / WhatsApp</small>{currentItem.contactPhone}
                </div>
              )}
              {currentItem.contactEmail && (
                <div className="contact-chip">
                  <small>Email</small>{currentItem.contactEmail}
                </div>
              )}
            </div>
          </div>

          <div className="modal-section">
            {!ownerVerified ? (
              <div className="sold-section">
                <p>Are you the seller? Enter your secret code to manage this listing.</p>
                <div className="sold-row">
                  <input
                    className="form-input"
                    aria-label="Secret listing code"
                    placeholder={`Enter your ${CODE_LENGTH}-character code`}
                    value={code}
                    onChange={(e) => { setCode(normaliseCode(e.target.value)); setCodeError(""); }}
                    style={{ flex: 1, textTransform: "uppercase", letterSpacing: "0.15em", fontFamily: "monospace", fontSize: 16 }}
                    maxLength={CODE_LENGTH}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  />
                  <button className="btn btn-ghost btn-sm" type="button" onClick={handleVerify} disabled={verifying}>{verifying ? "Checking…" : "Verify"}</button>
                </div>
                {codeError && <div className="error-msg" role="alert" style={{ marginTop: 8 }}>{codeError}</div>}
              </div>
            ) : (
              <div className="owner-actions">
                <div className="owner-actions-title">✅ Owner Verified — Manage Listing</div>
                <div className="owner-actions-row">
                  <button className="btn btn-warning btn-sm" type="button" onClick={() => setEditMode(true)}>✏️ Edit Listing</button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={handleSold} disabled={removing}>{removing ? "Removing…" : "🚫 Mark as Sold"}</button>
                </div>
                {codeError && <div className="error-msg" role="alert" style={{ marginTop: 8 }}>{codeError}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmitForm({ onSubmitted, onViewTerms, onViewStore }) {
  const emptyForm = {
    title: "", brand: "", equipmentType: "", size: "", color: "", condition: "",
    price: "", description: "",
    contactName: "", contactPhone: "", contactEmail: "",
  };
  const [form, setForm] = useState(emptyForm);
  const { images, setImages, imageError, setImageError, fileRef, handleFiles, removeImage } = useImageUpload([]);
  const [errors, setErrors] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [drag, setDrag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Please enter a title";
    if (!form.size) e.size = "Please select a size";
    if (!form.condition) e.condition = "Please select a condition";
    if (!form.price || isNaN(form.price) || Number(form.price) <= 0) e.price = "Please enter a valid price";
    if (!form.contactName.trim()) e.contactName = "Your name is required";
    if (!form.contactPhone.trim() && !form.contactEmail.trim()) e.contactEmail = "Please provide at least one contact method: phone/WhatsApp or email";
    if (!agreed) e.agreed = "You must agree to the Terms & Conditions to submit a listing";
    return e;
  };

  const resetForm = () => {
    setSubmitted(null);
    setForm(emptyForm);
    setImages([]);
    setImageError("");
    setAgreed(false);
    setErrors({});
    setSubmitError("");
    setCopyStatus("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    setSubmitError("");

    try {
      const secretCode = generateCode();
      const secretCodeHash = await sha256Hex(secretCode);
      const newItem = {
        id: generateId(),
        ...form,
        price: Number(form.price),
        images,
        secretCodeHash,
        listedAt: new Date().toISOString(),
      };

      await onSubmitted(newItem);
      setSubmitted({ secretCode, title: newItem.title, contactEmail: form.contactEmail.trim() });
    } catch (error) {
      setSubmitError(getStorageErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    const emailDraftHref = buildSellerCodeMailto(submitted);
    const reminderText = getSellerCodeReminderText(submitted);

    const handleCopyReminder = async () => {
      const copied = await copyTextToClipboard(reminderText);
      setCopyStatus(copied ? "Reminder text copied. Paste it into any email, note or message." : "Copy failed. Please screenshot the code before leaving this page.");
    };

    const handleCopyCode = async () => {
      const copied = await copyTextToClipboard(submitted.secretCode);
      setCopyStatus(copied ? "Seller code copied." : "Copy failed. Please screenshot the code before leaving this page.");
    };

    return (
      <div className="form-section">
        <div className="success-banner" role="status">
          <h3>🎉 Item Listed!</h3>
          <p>
            <strong>“{submitted.title}”</strong> is now live in the Used Uniform Shop.<br />
            Save your secret code — you'll need it to edit or mark your item as sold.
          </p>
          <div className="secret">{submitted.secretCode}</div>
          <div className="success-actions">
            {submitted.contactEmail && (
              <a className="btn btn-ghost btn-sm" href={emailDraftHref}>✉️ Open email draft</a>
            )}
            <button className="btn btn-ghost btn-sm" type="button" onClick={handleCopyReminder}>📋 Copy reminder text</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={handleCopyCode}>Copy code only</button>
          </div>
          {copyStatus && <p className="success-small-note" role="status"><strong>{copyStatus}</strong></p>}
          <p className="success-small-note">Screenshot this code and keep it safe. Use it to edit your listing or mark it as sold. Please remove the listing if the item sells elsewhere.</p>
          {submitted.contactEmail ? (
            <p className="success-small-note"><strong>Note:</strong> “Open email draft” uses your device's default email app. If nothing opens, use “Copy reminder text” and paste it into your email or notes.</p>
          ) : (
            <p className="success-small-note"><strong>No email was provided.</strong> Use “Copy reminder text”, copy the code, or screenshot it before leaving this page.</p>
          )}
        </div>
        <div className="edit-save-row">
          <button className="btn btn-primary" style={{ flex: 1 }} type="button" onClick={onViewStore}>
            View Store
          </button>
          <button className="btn btn-ghost" type="button" onClick={resetForm}>
            List Another Item
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form-section" onSubmit={handleSubmit}>
      <div className="form-title">List Your Item</div>
      <div className="form-sub">Fill in the details below. Buyers will contact you directly — we never handle payment or shipping.</div>

      <div className="form-group">
        <label className="form-label" htmlFor="listing-title">Listing Title <span className="req">*</span></label>
        <input id="listing-title" className="form-input" placeholder="e.g. Adidas Dobok Kids Size S" value={form.title} onChange={e => set("title", e.target.value)} />
        {errors.title && <div className="error-msg">{errors.title}</div>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="listing-brand">Brand</label>
        <input id="listing-brand" className="form-input" placeholder="e.g. Adidas, Mooto, Daedo, No brand" value={form.brand} onChange={e => set("brand", e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="listing-equipment-type">Equipment Type</label>
        <select id="listing-equipment-type" className="form-select" value={form.equipmentType} onChange={e => set("equipmentType", e.target.value)}>
          <option value="">— Select —</option>
          {EQUIPMENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="form-hint">Choose Body Armour for protective kit such as chest guards, head guards, gloves, shin/forearm guards and foot protectors.</div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="listing-size">Size <span className="req">*</span></label>
          <select id="listing-size" className="form-select" value={form.size} onChange={e => set("size", e.target.value)}>
            <option value="">— Select —</option>
            {renderSizeOptions()}
          </select>
          {errors.size && <div className="error-msg">{errors.size}</div>}
          <div className="form-hint">For doboks, cm sizes refer to approximate wearer height.</div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="listing-color">Colour</label>
          <input id="listing-color" className="form-input" placeholder="e.g. white, blue, red, black" value={form.color} onChange={e => set("color", e.target.value)} />
          <div className="form-hint">Type the colour shown on the item label or in the photos.</div>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="listing-condition">Condition <span className="req">*</span></label>
          <select id="listing-condition" className="form-select" value={form.condition} onChange={e => set("condition", e.target.value)}>
            <option value="">— Select —</option>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
          {errors.condition && <div className="error-msg">{errors.condition}</div>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="listing-price">Asking Price (£) <span className="req">*</span></label>
          <input id="listing-price" className="form-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form.price} onChange={e => set("price", e.target.value)} />
          {errors.price && <div className="error-msg">{errors.price}</div>}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="listing-description">Description</label>
        <textarea id="listing-description" className="form-textarea" placeholder="Any extra details — belt included, minor stains, worn 3 times, etc." value={form.description} onChange={e => set("description", e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Photos (up to {MAX_IMAGES})</label>
        <div
          className={`upload-area ${drag ? "drag" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => handleFiles(e.target.files)} aria-label="Upload listing photos" />
          <div className="upload-icon">📸</div>
          <div className="upload-text">Drag & drop or <strong>click to browse</strong><br /><span style={{ fontSize: 12 }}>JPG, PNG, WEBP — max {MAX_IMAGES} photos, 6MB each; resized automatically</span></div>
        </div>
        {imageError && <div className="info-msg">{imageError}</div>}
        {images.length > 0 && (
          <div className="previews">
            {images.map((src, i) => (
              <div className="preview-wrap" key={src.slice(0, 40) + i}>
                <img className="preview-thumb" src={src} alt={`Preview ${i + 1}`} />
                <button type="button" className="remove-img" onClick={() => removeImage(i)} aria-label={`Remove photo ${i + 1}`}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ paddingTop: 12, marginBottom: 4 }}>
        <div className="form-label" style={{ fontSize: 14, color: "#0648a8", marginBottom: 14 }}>Your Contact Details</div>
      </div>

      <div className="contact-note">You can provide phone/WhatsApp, email, or both. At least one contact method is required so buyers can reach you.</div>

      <div className="form-group">
        <label className="form-label" htmlFor="listing-contact-name">Your Name <span className="req">*</span></label>
        <input id="listing-contact-name" className="form-input" placeholder="First name or full name" value={form.contactName} onChange={e => set("contactName", e.target.value)} />
        {errors.contactName && <div className="error-msg">{errors.contactName}</div>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="listing-contact-phone">Phone / WhatsApp</label>
          <input id="listing-contact-phone" className="form-input" type="tel" placeholder="07700 900000" value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="listing-contact-email">Email</label>
          <input id="listing-contact-email" className="form-input" type="email" placeholder="you@email.com" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} />
          {errors.contactEmail && <div className="error-msg">{errors.contactEmail}</div>}
        </div>
      </div>

      <div className="secret-box" style={{ marginBottom: 20 }}>
        <p>
          <strong>🔒 About your secret code</strong>
          After submitting, you'll receive an {CODE_LENGTH}-character code. When your item sells, click your listing and enter this code to edit or remove it from the shop. If you add an email address, the next screen can open a ready-made email with the code and housekeeping reminder.
        </p>
      </div>

      <div className="checkbox-group">
        <input id="agree-terms" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <label htmlFor="agree-terms">
          By submitting this listing I confirm the information is accurate and I agree to the{" "}
          <button type="button" className="link-button" onClick={onViewTerms}>Terms &amp; Conditions</button>.
          I understand that no payments or financial information are collected by this site, and that all transactions are arranged directly between buyers and sellers at my own risk.
        </label>
      </div>
      {errors.agreed && <div className="checkbox-error">{errors.agreed}</div>}
      {submitError && <div className="error-msg" role="alert" style={{ marginBottom: 16 }}>{submitError}</div>}

      <button className="btn btn-primary btn-full" type="submit" disabled={saving}>
        {saving ? "Saving…" : "🥋 List My Item"}
      </button>
    </form>
  );
}

function TermsPage({ onBack }) {
  const clauses = [
    {
      num: "Clause 1",
      title: "About This Shop",
      body: [
        "This site is operated voluntarily by parents of Phoenix Taekwondo club members. It exists solely to help club families buy and sell used uniforms and equipment within the club community.",
        "This is an unofficial shop and is not affiliated with, endorsed by, or operated by Phoenix Taekwondo club, its instructors, or any governing taekwondo body.",
      ]
    },
    {
      num: "Clause 2",
      title: "Your Personal Data",
      body: [
        "When you submit a listing, your name, contact details (phone number and/or email address), and any photos you upload are stored on this shop for the purpose of connecting you with potential buyers.",
        "Your information is not shared with third parties, used for marketing, or sold. It is visible to anyone who views your listing. By submitting a listing you consent to this. Your data will be removed from the shop when your listing is marked as sold.",
      ]
    },
    {
      num: "Clause 3",
      title: "No Financial Information",
      body: [
        "This site does not collect, process, or store any payment details, bank account information, card numbers, or any other financial information whatsoever.",
        "All payments are arranged privately and directly between buyers and sellers. We strongly recommend meeting in person at the club to exchange items and payment safely.",
      ]
    },
    {
      num: "Clause 4",
      title: "Club Liability",
      body: [
        "Phoenix Taekwondo club, its instructors, committee members, and the parent volunteers who operate this site accept no responsibility for the accuracy of any listing, the condition of any item sold, or any disputes, losses, damages, or dissatisfaction arising from transactions between buyers and sellers.",
        "All transactions are made entirely at the buyer's and seller's own risk. We are simply providing a noticeboard — we are not a party to any sale.",
      ]
    },
    {
      num: "Clause 5",
      title: "Seller Responsibilities",
      body: [
        "By submitting a listing, you confirm that the information provided is accurate and truthful, that the item is genuinely available for sale, and that you are the rightful owner.",
        "You agree to respond promptly to enquiries and to mark your listing as sold as soon as the item has been sold, so it is removed from the shop.",
      ]
    },
    {
      num: "Clause 6",
      title: "Buyer Responsibilities",
      body: [
        "It is your responsibility as a buyer to inspect any item before completing a purchase. We recommend arranging to view items in person, ideally at the club.",
        "If you have any concerns about a listing, please contact us using the details below rather than proceeding with a purchase.",      ]
    },
    {
      num: "Clause 7",
      title: "Contact Us",
      body: [
        "For any questions, concerns, or requests to have a listing removed, please contact the site administrators:",
      ],
      contact: true,
    },
  ];

  return (
    <div className="tc-section">
      <button className="btn btn-ghost btn-sm" type="button" style={{ marginBottom: 24 }} onClick={onBack}>← Back</button>
      <div className="tc-title">Terms &amp; Conditions</div>
      <div className="tc-subtitle">Last updated: June 2026 · Phoenix Taekwondo Used Uniform Shop</div>

      {clauses.map((c, i) => (
        <div className="tc-clause" key={i}>
          <div className="tc-clause-num">{c.num}</div>
          <div className="tc-clause-title">{c.title}</div>
          {c.body.map((p, j) => <p key={j}>{p}</p>)}
          {c.contact && (
            <div className="tc-contact-box">
              <small>Email</small>
              usedTKDstuff@icloud.com
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Footer({ onViewTerms }) {
  return (
    <footer className="footer">
      <div className="footer-divider" />
      <div className="footer-disclaimer">
        This is an unofficial shop run by parents of Phoenix Taekwondo club members. No payments or financial information are collected or stored here. All transactions are arranged directly between buyers and sellers at their own risk. Phoenix Taekwondo club accepts no liability for any transactions made through this shop.
        <br /><br />
        By using this site and submitting a listing, you agree to our{" "}
        <button type="button" className="footer-link" onClick={onViewTerms}>Terms &amp; Conditions</button>.
        {" "}For enquiries, contact{" "}
        <a href="mailto:usedTKDstuff@icloud.com">usedTKDstuff@icloud.com</a>.
      </div>
    </footer>
  );
}

function AdminPage({ listings, onDelete, onLogout }) {
  const [confirming, setConfirming] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState("");

  const handleDelete = async (id) => {
    if (confirming !== id) {
      setConfirming(id);
      setActionError("");
      return;
    }

    setDeletingId(id);
    setActionError("");

    try {
      await onDelete(id);
      setConfirming(null);
    } catch (error) {
      setActionError(getStorageErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  };

  const dobokCount = listings.filter(l => l.equipmentType === "Dobok").length;
  const otherCount = listings.length - dobokCount;

  return (
    <div className="admin-section">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
        <div>
          <div className="admin-title">🛡️ Admin Panel</div>
          <div className="admin-sub">Manage all listings on behalf of sellers.</div>
        </div>
        <button className="btn btn-ghost btn-sm admin-logout" type="button" onClick={onLogout}>Log Out</button>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <div className="admin-stat-num">{listings.length}</div>
          <div className="admin-stat-label">Total Listings</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-num">{dobokCount}</div>
          <div className="admin-stat-label">Doboks</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-num">{otherCount}</div>
          <div className="admin-stat-label">Equipment</div>
        </div>
      </div>

      {actionError && <div className="global-error" role="alert" style={{ marginBottom: 18 }}>{actionError}</div>}

      {listings.length === 0 ? (
        <div className="empty-state" style={{ padding: "40px 0" }}>
          <div className="icon">📭</div>
          <p>No listings to manage.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Size</th>
                <th>Price</th>
                <th>Seller</th>
                <th>Contact</th>
                <th>Listed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map(l => (
                <tr key={l.id}>
                  <td>
                    <strong style={{ color: "#0f172a" }}>{l.title}</strong>
                    {l.brand && <small>{l.brand}</small>}
                  </td>
                  <td>{l.equipmentType || "—"}</td>
                  <td>{l.size || "—"}</td>
                  <td style={{ color: "#0648a8", fontWeight: 700 }}>{formatPrice(l.price)}</td>
                  <td>{l.contactName}</td>
                  <td>
                    {l.contactPhone && <small>📱 {l.contactPhone}</small>}
                    {l.contactEmail && <small>✉️ {l.contactEmail}</small>}
                  </td>
                  <td style={{ color: "#94a3b8", fontSize: 12 }}>
                    {l.listedAt ? new Date(l.listedAt).toLocaleDateString("en-GB") : "—"}
                  </td>
                  <td>
                    {confirming === l.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-danger btn-sm" type="button" onClick={() => handleDelete(l.id)} disabled={deletingId === l.id}>{deletingId === l.id ? "Deleting…" : "Confirm"}</button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => handleDelete(l.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("store");
  const [prevTab, setPrevTab] = useState("store");
  const [listings, setListings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sizeFilter, setSizeFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("newest");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage?.getItem(ADMIN_SESSION_KEY) === "true";
  });
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminChecking, setAdminChecking] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [logoTaps, setLogoTaps] = useState(0);
  const logoTapTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const storedListings = await loadListings();
        setListings(storedListings);
        setStorageError("");
      } catch (error) {
        setStorageError(getStorageErrorMessage(error));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persistListings = async (updated) => {
    await saveListings(updated);
    setListings(updated);
    setStorageError("");
  };

  const handleNewListing = async (item) => {
    if (SUPABASE_ENABLED) {
      const savedItem = await createRemoteListing(item);
      setListings(current => [savedItem, ...current]);
      setStorageError("");
      return;
    }

    const updated = [item, ...listings];
    await persistListings(updated);
  };

  const handleSold = async (id, sellerCode) => {
    if (SUPABASE_ENABLED) {
      await deleteRemoteListing(id, sellerCode);
      setListings(current => current.filter(l => l.id !== id));
      setStorageError("");
      return;
    }

    const updated = listings.filter(l => l.id !== id);
    await persistListings(updated);
  };

  const handleEdit = async (updatedItem, sellerCode) => {
    if (SUPABASE_ENABLED) {
      const savedItem = await updateRemoteListing(updatedItem, sellerCode);
      setListings(current => current.map(l => l.id === savedItem.id ? savedItem : l));
      setStorageError("");
      return savedItem;
    }

    const updated = listings.map(l => l.id === updatedItem.id ? updatedItem : l);
    await persistListings(updated);
    return updatedItem;
  };

  const handleAdminDelete = async (id) => {
    if (SUPABASE_ENABLED) {
      await adminDeleteRemoteListing(id);
      setListings(current => current.filter(l => l.id !== id));
      setStorageError("");
      return;
    }

    const updated = listings.filter(l => l.id !== id);
    await persistListings(updated);
  };

  const handleLogoTap = () => {
    const newCount = logoTaps + 1;
    setLogoTaps(newCount);
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (newCount >= 5) {
      setLogoTaps(0);
      setTab("admin");
    } else {
      logoTapTimer.current = setTimeout(() => setLogoTaps(0), 2000);
    }
  };

  const handleAdminLogin = async () => {
    setAdminChecking(true);
    setAdminError("");

    try {
      const cleanPassword = normaliseCode(adminPassword);
      const result = await verifyAdminPassword(cleanPassword);
      if (result.ok) {
        setAdminLoggedIn(true);
        window.sessionStorage?.setItem(ADMIN_SESSION_KEY, "true");
        window.sessionStorage?.setItem(ADMIN_PASSWORD_SESSION_KEY, cleanPassword);
        setAdminPassword("");
      } else {
        setAdminError(result.error || "Incorrect password.");
      }
    } catch (error) {
      setAdminError(error.message || "Could not verify admin password.");
    } finally {
      setAdminChecking(false);
    }
  };

  
  const filtered = listings.filter(l => {
    if (sizeFilter === "Dobok") { if (l.equipmentType !== "Dobok") return false; }
    else if (sizeFilter === "Other") { if (l.equipmentType === "Dobok") return false; }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        l.title?.toLowerCase().includes(q) ||
        l.brand?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.size?.toLowerCase().includes(q) ||
        l.condition?.toLowerCase().includes(q) ||
        l.equipmentType?.toLowerCase().includes(q) ||
        l.contactName?.toLowerCase().includes(q)
      );
    }
    return true;
  });
  const sortedListings = sortListings(filtered, sortOrder);

  const beltColors = [
    { base: "#FFFFFF", stripe: null },           // White
    { base: "#FFFFFF", stripe: "#FFD700" },      // White with yellow stripe
    { base: "#FFD700", stripe: null },           // Yellow
    { base: "#FFD700", stripe: "#228B22" },      // Yellow with green stripe
    { base: "#228B22", stripe: null },           // Green
    { base: "#228B22", stripe: "#1E3A8A" },      // Green with blue stripe
    { base: "#1E3A8A", stripe: null },           // Blue
    { base: "#1E3A8A", stripe: "#0648a8" },      // Blue with red stripe
    { base: "#0648a8", stripe: null },           // Red
    { base: "#0648a8", stripe: "#1A1A1A" },      // Red with black stripe
    { base: "#1A1A1A", stripe: null },           // Black
  ];

  return (
    <div className="app">
      <style>{styles}</style>

      <nav className="nav">
        <div
          className="nav-logo"
          role="button"
          tabIndex={0}
          onClick={handleLogoTap}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleLogoTap()}
          style={{ cursor: "default", userSelect: "none" }}
          aria-label="Phoenix Taekwondo marketplace logo"
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>🥋</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", lineHeight: 1.2 }}>
              PHOENIX <span style={{ color: "#0648a8" }}>TKD KIT</span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "#64748b", lineHeight: 1.2, textTransform: "uppercase" }}>
              Pre-loved kit marketplace
            </div>
          </div>
        </div>
        <div className="nav-tabs">
          <button type="button" className={`nav-tab ${tab === "store" ? "active" : ""}`} onClick={() => setTab("store")}>
            Store {listings.length > 0 && <span className="badge">{listings.length}</span>}
          </button>
          <button type="button" className={`nav-tab ${tab === "sell" ? "active" : ""}`} onClick={() => setTab("sell")}>
            List an Item
          </button>
          <button type="button" className={`nav-tab ${tab === "terms" ? "active" : ""}`} onClick={() => { setPrevTab(tab); setTab("terms"); }} style={{ textTransform: "none" }}>
            T&amp;Cs
          </button>
        </div>
      </nav>

      {storageError && <div className="global-error" role="alert">{storageError}</div>}

      {tab === "store" && (
        <>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-inner">
              <div className="hero-copy">
                <div className="hero-kicker">Phoenix TKD community</div>
                <h1 id="hero-title">Pre-loved<br /><span>Taekwondo Kit</span><br />Marketplace</h1>
                <p className="hero-sub">Buy and sell outgrown uniforms, belts, sparring gear and club kit within the Phoenix TKD community.</p>
                <div className="hero-actions">
                  <button className="btn btn-primary" type="button" onClick={() => setTab("sell")}>＋ List an Item</button>
                  <button className="btn btn-ghost" type="button" onClick={() => document.getElementById("listings")?.scrollIntoView({ behavior: "smooth", block: "start" })}>🔍 Browse Listings</button>
                </div>
                <div className="hero-trust-row" aria-label="Marketplace notes">
                  <span>🛡️ Club community marketplace</span>
                  <span>👥 Seller contact shown</span>
                  <span>🔒 Safe &amp; easy to use</span>
                </div>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <img
                  className="hero-kit-image"
                  src="/hero-gear.webp"
                  alt=""
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <div className="gear-stage">
                  <div className="dobok-piece">
                    <div className="dobok-neck" />
                    <div className="dobok-brand">TUSAH<small>dobok</small></div>
                  </div>
                  <div className="helmet-piece">
                    <span className="helmet-hole" />
                    <span className="helmet-brand">adidas</span>
                  </div>
                  <div className="armour-piece">
                    <span className="armour-brand">adidas</span>
                    <span className="armour-number">3</span>
                  </div>
                  <div className="hero-belt"><span className="belt-knot" /></div>
                  <div className="glove-piece"><span className="glove-brand">adidas</span></div>
                </div>
              </div>
            </div>
          </section>

          <div className="store-section" id="listings">
            <div className="store-header">
              <div className="store-title">
                Sort & Browse
                {loaded && <span className="badge">{filtered.length}</span>}
              </div>
              <div className="store-controls">
                <div className="filter-row" aria-label="Filter listings">
                  {["All", "Dobok", "Other"].map(t => (
                    <button key={t} type="button" className={`filter-btn ${sizeFilter === t ? "active" : ""}`} onClick={() => setSizeFilter(t)}>{t}</button>
                  ))}
                </div>
                <label className="sort-control" htmlFor="listing-sort">
                  <span>Sort</span>
                  <select id="listing-sort" className="sort-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                    {SORT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="store-note">
              <span><strong>Shared club marketplace:</strong> new listings are saved to the database and visible to other visitors.</span>
              <span>Payments and collection are arranged directly with the seller.</span>
            </div>

            <div className="search-bar-wrap">
              <span className="search-bar-icon">🔍</span>
              <input
                className="search-bar"
                placeholder="Search by title, brand, size, condition…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="search-clear" type="button" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
              )}
            </div>

            {search.trim() && (
              <div className="search-results-info">
                {filtered.length === 0
                  ? <>No results for <strong>"{search}"</strong></>
                  : <>{filtered.length} result{filtered.length !== 1 ? "s" : ""} for <strong>"{search}"</strong></>
                }
              </div>
            )}

            <div className="grid">
              {!loaded ? (
                <div className="empty-state"><div className="icon">⏳</div><p>Loading listings…</p></div>
              ) : filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="icon">🥋</div>
                  <p style={{ color: "#64748b", fontSize: 18, fontFamily: "'Barlow', sans-serif", fontWeight: 700, textTransform: "uppercase" }}>No listings yet</p>
                  <div style={{ marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 12 }} onClick={() => setTab("sell")}>Be the first to list one →</button>
                  </div>
                </div>
              ) : (
                sortedListings.map(item => (
                  <UniformCard key={item.id} item={item} onClick={setSelected} />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {tab === "sell" && (
        <SubmitForm
          onSubmitted={handleNewListing}
          onViewStore={() => setTab("store")}
          onViewTerms={() => { setPrevTab("sell"); setTab("terms"); }}
        />
      )}

      {tab === "terms" && (
        <TermsPage onBack={() => setTab(prevTab || "store")} />
      )}

      {tab === "admin" && (
        adminLoggedIn ? (
          <AdminPage
            listings={listings}
            onDelete={handleAdminDelete}
            onLogout={() => { window.sessionStorage?.removeItem(ADMIN_SESSION_KEY); window.sessionStorage?.removeItem(ADMIN_PASSWORD_SESSION_KEY); setAdminLoggedIn(false); setTab("store"); }}
          />
        ) : (
          <div className="admin-login-box">
            <div style={{ fontSize: 36, marginBottom: 10 }}>🛡️</div>
            <h2>Admin Login</h2>
            <p>Enter the admin password saved in Supabase to manage listings.</p>
            <div className="form-group">
              <input
                className="form-input"
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={adminPassword}
                onChange={e => { setAdminPassword(normaliseCode(e.target.value)); setAdminError(""); }}
                onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
                style={{ textAlign: "center", letterSpacing: "0.15em" }}
              />
              {adminError && <div className="error-msg" style={{ textAlign: "center", marginTop: 8 }}>{adminError}</div>}
            </div>
            <button className="btn btn-primary btn-full" type="button" onClick={handleAdminLogin} disabled={adminChecking}>{adminChecking ? "Checking…" : "Login"}</button>
            <button className="btn btn-ghost btn-full" type="button" style={{ marginTop: 8 }} onClick={() => setTab("store")}>Cancel</button>
          </div>
        )
      )}

      {selected && (
        <DetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onSold={handleSold}
          onEdit={handleEdit}
        />
      )}

      <Footer onViewTerms={() => { setPrevTab(tab); setTab("terms"); }} />
    </div>
  );
}
