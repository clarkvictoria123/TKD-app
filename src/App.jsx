import { useState, useEffect, useRef } from "react";

const SIZES = [
  "XS", "S", "M", "L", "XL",
  "80cm", "90cm", "100cm", "110cm", "120cm", "130cm", "140cm",
  "150cm", "160cm", "170cm", "180cm", "190cm", "200cm", "210cm", "220cm"
];
const CONDITIONS = ["Like New", "Good", "Fair", "Well Loved"];
const COLORS = ["White", "Black", "Blue", "Other"];
const EQUIPMENT_TYPES = ["Dobok", "Body Armour", "Helmet", "Sparring Gloves", "Foot Protectors", "Other"];
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
    equipmentType: row.equipment_type || "",
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
    equipmentType: item.equipmentType || "",
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
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700;900&family=Barlow:wght@400;500;600&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background:
      radial-gradient(circle at top left, rgba(200,16,46,0.14), transparent 34rem),
      radial-gradient(circle at top right, rgba(212,168,67,0.10), transparent 30rem),
      #0B1829;
    color: #F0EDE8;
    font-family: 'Barlow', sans-serif;
  }

  .app { min-height: 100vh; }

  /* NAV */
  .nav {
    background: rgba(6,15,26,0.94);
    border-bottom: 2px solid #C8102E;
    backdrop-filter: blur(12px);
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .nav-logo {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 22px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .nav-logo span { color: #C8102E; }
  .nav-belt {
    width: 28px; height: 6px;
    background: linear-gradient(90deg, #C8102E 0%, #D4A843 100%);
    border-radius: 2px;
  }
  .nav-tabs {
    display: flex;
    gap: 4px;
  }
  .nav-tab {
    background: none;
    border: none;
    color: #8A9BB0;
    font-family: 'Barlow', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
  }
  .nav-tab:hover { color: #fff; background: rgba(255,255,255,0.06); }
  .nav-tab.active { color: #fff; background: #C8102E; }

  /* HERO */
  .hero {
    position: relative;
    background: #060F1A;
    padding: 60px 24px 50px;
    overflow: hidden;
    text-align: center;
  }
  .hero-stripe {
    position: absolute;
    top: -20px; left: -60px; right: -60px; bottom: -20px;
    background: repeating-linear-gradient(
      -15deg,
      transparent,
      transparent 60px,
      rgba(200,16,46,0.06) 60px,
      rgba(200,16,46,0.06) 62px
    );
    pointer-events: none;
  }
  .hero h1 {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: clamp(36px, 6vw, 68px);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1;
    color: #fff;
    position: relative;
  }
  .hero h1 em {
    font-style: normal;
    color: #C8102E;
  }
  .hero-sub {
    margin-top: 14px;
    color: #B8C4D2;
    font-size: 17px;
    font-weight: 400;
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
    position: relative;
    line-height: 1.6;
  }
  .hero-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 24px;
    position: relative;
  }
  .hero-actions .btn {
    box-shadow: 0 10px 28px rgba(0,0,0,0.22);
  }
  .hero-belt-row {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 30px;
    position: relative;
  }
  .belt-chip {
    height: 14px;
    border-radius: 3px;
    width: 36px;
  }

  /* STORE GRID */
  .store-section { padding: 34px 24px 64px; max-width: 1120px; margin: 0 auto; }
  .store-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .store-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 28px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #fff;
  }
  .store-note {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin: -8px 0 18px;
    padding: 12px 14px;
    border: 1px solid rgba(212,168,67,0.18);
    border-radius: 12px;
    background: rgba(212,168,67,0.06);
    color: #C8D6E5;
    font-size: 13px;
    line-height: 1.45;
  }
  .store-note strong { color: #D4A843; }
  .badge {
    background: #C8102E;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 20px;
    margin-left: 10px;
    letter-spacing: 0.04em;
  }
  .filter-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .filter-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #8A9BB0;
    font-family: 'Barlow', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 5px 14px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .filter-btn:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
  .filter-btn.active { background: #C8102E; border-color: #C8102E; color: #fff; }
  .store-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sort-control {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    padding: 5px 8px 5px 12px;
    color: #8A9BB0;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .sort-select {
    appearance: none;
    background: #071321;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px;
    color: #F0EDE8;
    cursor: pointer;
    font-family: 'Barlow', sans-serif;
    font-size: 13px;
    font-weight: 700;
    outline: none;
    padding: 6px 30px 6px 12px;
    background-image: linear-gradient(45deg, transparent 50%, #D4A843 50%), linear-gradient(135deg, #D4A843 50%, transparent 50%);
    background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }
  .sort-select:focus { border-color: #C8102E; box-shadow: 0 0 0 3px rgba(200,16,46,0.12); }

  .search-bar-wrap {
    position: relative;
    width: 100%;
    margin-bottom: 16px;
  }
  .search-bar-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: #4A6070;
    font-size: 16px;
    pointer-events: none;
  }
  .search-bar {
    width: 100%;
    background: #111E2E;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    color: #F0EDE8;
    font-family: 'Barlow', sans-serif;
    font-size: 15px;
    padding: 12px 40px 12px 42px;
    outline: none;
    transition: border-color 0.15s;
  }
  .search-bar::placeholder { color: #4A6070; }
  .search-bar:focus { border-color: #C8102E; box-shadow: 0 0 0 3px rgba(200,16,46,0.12); }
  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255,255,255,0.08);
    border: none;
    color: #8A9BB0;
    width: 24px; height: 24px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .search-clear:hover { background: rgba(200,16,46,0.2); color: #fff; }
  .search-results-info {
    font-size: 13px;
    color: #4A6070;
    margin-bottom: 16px;
  }
  .search-results-info strong { color: #C8102E; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }

  .card {
    width: 100%;
    position: relative;
    background: linear-gradient(180deg, #122236 0%, #0F1C2C 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    overflow: hidden;
    transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s;
    box-shadow: 0 12px 32px rgba(0,0,0,0.18);
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    appearance: none;
  }
  .card:hover {
    transform: translateY(-4px);
    border-color: rgba(200,16,46,0.48);
    box-shadow: 0 18px 42px rgba(0,0,0,0.28);
  }
  .card:focus-visible { outline: 3px solid rgba(200,16,46,0.45); outline-offset: 3px; }
  .card::before {
    content: "";
    display: block;
    height: 3px;
    background: linear-gradient(90deg, #C8102E, #D4A843);
  }

  .card-img {
    width: 100%;
    height: 220px;
    background:
      radial-gradient(circle at 50% 35%, rgba(255,255,255,0.06), transparent 48%),
      repeating-linear-gradient(45deg, rgba(255,255,255,0.022) 0 8px, transparent 8px 16px),
      #071321;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2A3D52;
    font-size: 48px;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    position: relative;
    padding: 10px;
  }
  .card-img img { width: 100%; height: 100%; object-fit: contain; object-position: center; border-radius: 10px; background: rgba(255,255,255,0.025); }
  .card-view-pill {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    background: rgba(200,16,46,0.92);
    border: 1px solid rgba(255,255,255,0.16);
    color: #fff;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    box-shadow: 0 8px 18px rgba(0,0,0,0.24);
    pointer-events: none;
  }
  .card-photo-count {
    position: absolute;
    right: 10px;
    bottom: 10px;
    background: rgba(6,15,26,0.84);
    border: 1px solid rgba(255,255,255,0.14);
    color: #fff;
    border-radius: 999px;
    padding: 4px 9px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    backdrop-filter: blur(4px);
  }

  .card-body { padding: 17px; }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .card-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #fff;
  }
  .card-price {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 22px;
    color: #D4A843;
    white-space: nowrap;
    background: rgba(212,168,67,0.10);
    border: 1px solid rgba(212,168,67,0.16);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .card-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .tag {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(255,255,255,0.07);
    color: #8A9BB0;
  }
  .tag.condition-new { background: rgba(52,199,89,0.15); color: #34C759; }
  .tag.condition-good { background: rgba(212,168,67,0.15); color: #D4A843; }
  .tag.condition-fair { background: rgba(200,16,46,0.12); color: #E84060; }
  .tag.condition-loved { background: rgba(138,155,176,0.16); color: #C8D6E5; }
  .card-desc {
    margin-top: 10px;
    color: #6B7E93;
    font-size: 13px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-seller-box {
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid rgba(212,168,67,0.18);
    border-radius: 12px;
    background: linear-gradient(180deg, rgba(212,168,67,0.10), rgba(6,15,26,0.34));
    color: #8A9BB0;
  }
  .card-seller-label {
    display: block;
    color: #D4A843;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    margin-bottom: 3px;
  }
  .card-seller-box strong {
    color: #F0EDE8;
    display: block;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-listed {
    margin-top: 8px;
    color: #4A6070;
    font-size: 12px;
  }

  .empty-state {
    grid-column: 1/-1;
    text-align: center;
    padding: 80px 20px;
    color: #2A3D52;
  }
  .empty-state .icon { font-size: 56px; }
  .empty-state p { margin-top: 12px; font-size: 16px; }

  /* MODAL (detail) */
  .overlay {
    position: fixed; inset: 0;
    background: rgba(6,15,26,0.88);
    z-index: 200;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    backdrop-filter: blur(4px);
  }
  .modal {
    background: #111E2E;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    width: 100%; max-width: 560px;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
  }
  .modal-close {
    position: absolute;
    top: 14px; right: 14px;
    background: rgba(255,255,255,0.08);
    border: none;
    color: #8A9BB0;
    width: 32px; height: 32px;
    border-radius: 8px;
    font-size: 18px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .modal-close:hover { background: rgba(200,16,46,0.2); color: #fff; }

  .modal-img {
    position: relative;
    width: 100%; min-height: 280px; height: min(64vh, 520px);
    background:
      radial-gradient(circle at 50% 40%, rgba(255,255,255,0.06), transparent 48%),
      repeating-linear-gradient(45deg, rgba(255,255,255,0.022) 0 8px, transparent 8px 16px),
      #071321;
    display: flex; align-items: center; justify-content: center;
    font-size: 72px;
    color: #1A2F45;
    border-radius: 16px 16px 0 0;
    overflow: hidden;
    padding: 12px;
  }
  .modal-img img { width: 100%; height: 100%; object-fit: contain; border-radius: 10px; }
  .modal-img-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 4;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(6,15,26,0.76);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 34px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 12px 26px rgba(0,0,0,0.30);
    transition: transform 0.15s, background 0.15s, border-color 0.15s;
  }
  .modal-img-arrow:hover {
    background: rgba(200,16,46,0.92);
    border-color: rgba(255,255,255,0.30);
    transform: translateY(-50%) scale(1.04);
  }
  .modal-img-arrow:focus-visible { outline: 3px solid rgba(212,168,67,0.55); outline-offset: 3px; }
  .modal-img-arrow-left { left: 14px; padding-bottom: 4px; }
  .modal-img-arrow-right { right: 14px; padding-bottom: 4px; }
  .modal-img-counter {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 4;
    background: rgba(6,15,26,0.78);
    border: 1px solid rgba(255,255,255,0.14);
    color: #F0EDE8;
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.05em;
    box-shadow: 0 8px 18px rgba(0,0,0,0.26);
  }
  .modal-dots {
    display: flex;
    justify-content: center;
    gap: 6px;
    padding: 9px 0 0;
    background: #111E2E;
  }
  .modal-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 0;
  }
  .modal-dot.active { background: #C8102E; }

  .modal-body { padding: 24px; }
  .modal-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 28px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #fff;
  }
  .modal-price {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 32px;
    color: #D4A843;
    margin-top: 4px;
  }
  .modal-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .modal-desc {
    margin-top: 16px;
    color: #8A9BB0;
    font-size: 15px;
    line-height: 1.6;
  }
  .modal-section {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .modal-section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #C8102E;
    margin-bottom: 10px;
  }
  .contact-row {
    display: flex; gap: 10px; flex-wrap: wrap;
  }
  .contact-chip {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 14px;
    color: #F0EDE8;
  }
  .contact-chip small { display: block; font-size: 11px; color: #6B7E93; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.06em; }

  .sold-section {
    margin-top: 20px;
    padding: 16px;
    background: rgba(200,16,46,0.07);
    border: 1px solid rgba(200,16,46,0.2);
    border-radius: 10px;
  }
  .sold-section p { font-size: 13px; color: #8A9BB0; margin-bottom: 10px; }
  .sold-row { display: flex; gap: 8px; }

  .owner-actions {
    margin-top: 20px;
    padding: 16px;
    background: rgba(212,168,67,0.07);
    border: 1px solid rgba(212,168,67,0.2);
    border-radius: 10px;
  }
  .owner-actions-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #D4A843; margin-bottom: 12px;
  }
  .owner-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn-warning { background: rgba(212,168,67,0.15); color: #D4A843; border: 1px solid rgba(212,168,67,0.3); }
  .btn-warning:hover { background: rgba(212,168,67,0.28); }

  .edit-modal-body { padding: 20px 24px 24px; }
  .edit-modal-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 22px; text-transform: uppercase;
    letter-spacing: 0.03em; color: #fff; margin-bottom: 4px;
  }
  .edit-modal-sub { font-size: 13px; color: #6B7E93; margin-bottom: 20px; }
  .edit-save-row { display: flex; gap: 8px; margin-top: 24px; }
  .edit-updated-banner {
    background: rgba(52,199,89,0.1);
    border: 1px solid rgba(52,199,89,0.25);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 14px;
    color: #34C759;
    text-align: center;
    margin-top: 16px;
  }

  /* FORM */
  .form-section { padding: 32px 24px 60px; max-width: 640px; margin: 0 auto; }
  .form-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 32px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #fff;
    margin-bottom: 6px;
  }
  .form-sub { color: #6B7E93; font-size: 14px; margin-bottom: 32px; line-height: 1.5; }

  .form-group { margin-bottom: 20px; }
  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #8A9BB0;
    margin-bottom: 7px;
  }
  .form-label .req { color: #C8102E; margin-left: 3px; }
  .form-input, .form-select, .form-textarea {
    width: 100%;
    background: #0B1829;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    color: #F0EDE8;
    font-family: 'Barlow', sans-serif;
    font-size: 15px;
    padding: 11px 14px;
    transition: border-color 0.15s;
    outline: none;
    appearance: none;
  }
  .form-input:focus, .form-select:focus, .form-textarea:focus {
    border-color: #C8102E;
    box-shadow: 0 0 0 3px rgba(200,16,46,0.12);
  }
  .form-textarea { min-height: 90px; resize: vertical; line-height: 1.5; }
  .form-select { cursor: pointer; }
  .form-select option { background: #111E2E; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .upload-area {
    border: 2px dashed rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 32px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.15s;
    background: #0B1829;
    position: relative;
  }
  .upload-area:hover, .upload-area.drag { border-color: #C8102E; background: rgba(200,16,46,0.05); }
  .upload-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .upload-icon { font-size: 32px; margin-bottom: 8px; }
  .upload-text { color: #6B7E93; font-size: 14px; }
  .upload-text strong { color: #C8102E; }
  .previews { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .preview-thumb {
    width: 72px; height: 72px;
    border-radius: 8px;
    object-fit: contain;
    background: #0B1829;
    padding: 4px;
    border: 1px solid rgba(255,255,255,0.1);
    position: relative;
  }
  .preview-wrap { position: relative; display: inline-block; }
  .remove-img {
    position: absolute; top: -6px; right: -6px;
    background: #C8102E; color: #fff;
    border: none; border-radius: 50%;
    width: 18px; height: 18px; font-size: 11px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    line-height: 1;
  }

  .secret-box {
    background: rgba(212,168,67,0.08);
    border: 1px solid rgba(212,168,67,0.25);
    border-radius: 10px;
    padding: 14px 16px;
    margin-top: 8px;
  }
  .secret-box p { font-size: 13px; color: #D4A843; line-height: 1.5; }
  .secret-box p strong { display: block; margin-bottom: 4px; font-size: 14px; }

  /* BUTTONS */
  .btn {
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 15px;
    padding: 11px 22px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn-primary { background: #C8102E; color: #fff; }
  .btn-primary:hover { background: #E01535; }
  .btn-primary:disabled { background: #3A2026; color: #6B3040; cursor: not-allowed; }
  .btn-ghost { background: rgba(255,255,255,0.07); color: #8A9BB0; }
  .btn-ghost:hover { background: rgba(255,255,255,0.12); color: #fff; }
  .btn-danger { background: rgba(200,16,46,0.15); color: #E84060; border: 1px solid rgba(200,16,46,0.3); }
  .btn-danger:hover { background: rgba(200,16,46,0.3); }
  .btn-sm { font-size: 13px; padding: 8px 14px; }
  .btn-full { width: 100%; justify-content: center; }

  .error-msg { color: #E84060; font-size: 13px; margin-top: 6px; }
  .info-msg { color: #D4A843; font-size: 13px; margin-top: 8px; line-height: 1.45; }
  .global-error {
    max-width: 900px;
    margin: 18px auto 0;
    padding: 12px 16px;
    border: 1px solid rgba(200,16,46,0.35);
    border-radius: 10px;
    background: rgba(200,16,46,0.12);
    color: #E84060;
    font-size: 14px;
  }
  .success-banner {
    background: rgba(52,199,89,0.1);
    border: 1px solid rgba(52,199,89,0.25);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    margin-bottom: 24px;
  }
  .success-banner h3 { color: #34C759; font-size: 18px; margin-bottom: 6px; }
  .success-banner p { color: #6B7E93; font-size: 14px; line-height: 1.5; }
  .success-banner .secret { 
    margin-top: 12px;
    background: #0B1829;
    border-radius: 6px;
    padding: 10px 16px;
    font-family: monospace;
    font-size: 20px;
    letter-spacing: 0.15em;
    color: #D4A843;
    font-weight: 700;
  }

  /* ADMIN */
  .admin-section { padding: 32px 24px 60px; max-width: 900px; margin: 0 auto; }
  .admin-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 32px;
    text-transform: uppercase; letter-spacing: 0.03em;
    color: #fff; margin-bottom: 6px;
  }
  .admin-sub { font-size: 13px; color: #6B7E93; margin-bottom: 28px; }
  .admin-login-box {
    max-width: 360px;
    background: #111E2E;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 28px 24px;
    margin: 60px auto;
    text-align: center;
  }
  .admin-login-box h2 {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 22px;
    text-transform: uppercase; letter-spacing: 0.04em;
    color: #fff; margin-bottom: 6px;
  }
  .admin-login-box p { font-size: 13px; color: #6B7E93; margin-bottom: 20px; }
  .admin-table { width: 100%; border-collapse: collapse; }
  .admin-table th {
    text-align: left; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: #6B7E93; padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .admin-table td {
    padding: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    font-size: 14px; color: #C8D6E5; vertical-align: middle;
  }
  .admin-table tr:hover td { background: rgba(255,255,255,0.02); }
  .admin-table td small { display: block; font-size: 11px; color: #4A6070; margin-top: 2px; }
  .admin-stats {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;
  }
  .admin-stat {
    background: #111E2E;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 14px 20px;
    min-width: 120px;
  }
  .admin-stat-num {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 32px; color: #fff;
  }
  .admin-stat-label { font-size: 12px; color: #6B7E93; text-transform: uppercase; letter-spacing: 0.06em; }
  .admin-logout { float: right; }

  @media (max-width: 600px) {
    .form-row { grid-template-columns: 1fr; }
    .nav { height: auto; min-height: 64px; padding: 10px 12px; gap: 10px; align-items: flex-start; }
    .nav-tabs { flex-wrap: wrap; justify-content: flex-end; }
    .nav-tabs .nav-tab { font-size: 12px; padding: 7px 10px; }
    .hero { padding: 44px 18px 38px; }
    .hero h1 { font-size: 34px; }
    .hero-sub { font-size: 15px; }
    .grid { grid-template-columns: 1fr; }
    .card-img { height: 240px; }
    .modal-img { min-height: 260px; height: 52vh; }
    .sold-row { flex-direction: column; }
  }

  /* FOOTER */
  .footer {
    background: #060F1A;
    border-top: 1px solid rgba(255,255,255,0.07);
    padding: 24px;
    text-align: center;
  }
  .footer-disclaimer {
    font-size: 12px;
    color: #4A6070;
    line-height: 1.7;
    max-width: 640px;
    margin: 0 auto;
  }
  .footer-disclaimer a {
    color: #C8102E;
    text-decoration: underline;
    cursor: pointer;
  }
  .footer-disclaimer a:hover { color: #E84060; }
  .footer-divider {
    width: 40px; height: 2px;
    background: linear-gradient(90deg, #C8102E, #D4A843);
    border-radius: 2px;
    margin: 0 auto 16px;
  }

  /* T&C PAGE */
  .tc-section { padding: 40px 24px 60px; max-width: 720px; margin: 0 auto; }
  .tc-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 36px;
    text-transform: uppercase; letter-spacing: 0.03em;
    color: #fff; margin-bottom: 6px;
  }
  .tc-subtitle { font-size: 13px; color: #6B7E93; margin-bottom: 36px; }
  .tc-clause {
    margin-bottom: 28px;
    padding-bottom: 28px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .tc-clause:last-child { border-bottom: none; }
  .tc-clause-num {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.12em;
    color: #C8102E; margin-bottom: 6px;
  }
  .tc-clause-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 20px;
    text-transform: uppercase; letter-spacing: 0.03em;
    color: #fff; margin-bottom: 10px;
  }
  .tc-clause p {
    font-size: 14px; color: #8A9BB0;
    line-height: 1.75;
  }
  .tc-clause p + p { margin-top: 8px; }
  .tc-contact-box {
    background: #111E2E;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 16px 20px;
    margin-top: 10px;
    font-size: 14px;
    color: #F0EDE8;
  }
  .tc-contact-box small { display: block; font-size: 11px; color: #6B7E93; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }

  /* CHECKBOX */
  .checkbox-group {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    margin-bottom: 20px;
  }
  .checkbox-group input[type="checkbox"] {
    width: 18px; height: 18px;
    accent-color: #C8102E;
    flex-shrink: 0;
    margin-top: 2px;
    cursor: pointer;
  }
  .checkbox-group label {
    font-size: 13px; color: #8A9BB0;
    line-height: 1.6;
  }
  .link-button, .footer-link {
    background: none;
    border: none;
    color: #C8102E;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .link-button:hover, .footer-link:hover { color: #E84060; }
  .checkbox-error { color: #E84060; font-size: 13px; margin-top: -12px; margin-bottom: 16px; }

  @media (max-width: 680px) {
    .store-controls { justify-content: flex-start; width: 100%; }
    .sort-control { width: 100%; justify-content: space-between; border-radius: 14px; padding: 8px 10px 8px 12px; }
    .sort-select { flex: 1; min-width: 0; }
    .card-img { height: 200px; }
    .card-view-pill { top: 8px; right: 8px; }
    .modal-img-arrow { width: 38px; height: 38px; font-size: 30px; }
    .modal-img-arrow-left { left: 10px; }
    .modal-img-arrow-right { right: 10px; }
    .modal-img-counter { bottom: 10px; }
  }
`;


function conditionClass(c) {
  if (c === "Like New") return "condition-new";
  if (c === "Good") return "condition-good";
  if (c === "Well Loved") return "condition-loved";
  return "condition-fair";
}

function UniformCard({ item, onClick }) {
  const imageCount = Array.isArray(item.images) ? item.images.length : 0;
  const listedDate = formatDateShort(item.listedAt);

  return (
    <button type="button" className="card" onClick={() => onClick(item)} aria-label={`View ${item.title}`}>
      <div className="card-img">
        <span className="card-view-pill">View →</span>
        {imageCount > 0 ? (
          <img src={item.images[0]} alt={item.title} />
        ) : "🥋"}
        {imageCount > 1 && <span className="card-photo-count">📷 {imageCount}</span>}
      </div>
      <div className="card-body">
        <div className="card-top">
          <div className="card-name">{item.title}</div>
          <div className="card-price">{formatPrice(item.price)}</div>
        </div>
        <div className="card-tags">
          {item.equipmentType && <span className="tag" style={{ background: "rgba(200,16,46,0.13)", color: "#E84060" }}>{item.equipmentType}</span>}
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
    </button>
  );
}

function EditForm({ item, onSave, onCancel }) {
  const [form, setForm] = useState({
    title: item.title || "",
    brand: item.brand || "",
    equipmentType: item.equipmentType || "",
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
    if (!form.contactPhone.trim() && !form.contactEmail.trim()) e.contactEmail = "Please provide at least one contact method";
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
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="edit-size">Size <span className="req">*</span></label>
          <select id="edit-size" className="form-select" value={form.size} onChange={e => set("size", e.target.value)}>
            <option value="">— Select —</option>
            {SIZES.map(s => <option key={s}>{s}</option>)}
          </select>
          {errors.size && <div className="error-msg">{errors.size}</div>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="edit-color">Colour</label>
          <select id="edit-color" className="form-select" value={form.color} onChange={e => set("color", e.target.value)}>
            <option value="">— Select —</option>
            {COLORS.map(c => <option key={c}>{c}</option>)}
          </select>
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
        <div className="form-label" style={{ fontSize: 13, color: "#C8102E", marginBottom: 12 }}>Contact Details</div>
      </div>

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

  const images = Array.isArray(currentItem.images) ? currentItem.images : [];
  const imageCount = images.length;
  const hasMultipleImages = imageCount > 1;

  useEffect(() => {
    if (imgIdx >= imageCount) {
      setImgIdx(0);
    }
  }, [imageCount, imgIdx]);

  const showPreviousImage = (event) => {
    event?.stopPropagation();
    if (!hasMultipleImages) return;
    setImgIdx(index => (index - 1 + imageCount) % imageCount);
  };

  const showNextImage = (event) => {
    event?.stopPropagation();
    if (!hasMultipleImages) return;
    setImgIdx(index => (index + 1) % imageCount);
  };

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
          {imageCount > 0 ? (
            <>
              <img
                src={images[imgIdx]}
                alt={`${currentItem.title} photo ${imgIdx + 1}`}
                style={{ cursor: hasMultipleImages ? "pointer" : "default" }}
                onClick={(event) => hasMultipleImages && showNextImage(event)}
              />
              {hasMultipleImages && (
                <>
                  <button
                    className="modal-img-arrow modal-img-arrow-left"
                    type="button"
                    onClick={showPreviousImage}
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  <button
                    className="modal-img-arrow modal-img-arrow-right"
                    type="button"
                    onClick={showNextImage}
                    aria-label="Next photo"
                  >
                    ›
                  </button>
                  <div className="modal-img-counter" aria-live="polite">
                    {imgIdx + 1} / {imageCount}
                  </div>
                </>
              )}
            </>
          ) : "🥋"}
        </div>
        {hasMultipleImages && (
          <div className="modal-dots">
            {images.map((_, i) => (
              <button
                key={i}
                className={`modal-dot ${i === imgIdx ? "active" : ""}`}
                type="button"
                aria-label={`View photo ${i + 1}`}
                aria-current={i === imgIdx ? "true" : undefined}
                onClick={() => setImgIdx(i)}
              />
            ))}
          </div>
        )}
        <div className="modal-body">
          <div className="modal-title">{currentItem.title}</div>
          <div className="modal-price">{formatPrice(currentItem.price)}</div>
          <div className="modal-tags">
            {currentItem.equipmentType && <span className="tag" style={{ background: "rgba(200,16,46,0.13)", color: "#E84060" }}>{currentItem.equipmentType}</span>}
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

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Please enter a title";
    if (!form.size) e.size = "Please select a size";
    if (!form.condition) e.condition = "Please select a condition";
    if (!form.price || isNaN(form.price) || Number(form.price) <= 0) e.price = "Please enter a valid price";
    if (!form.contactName.trim()) e.contactName = "Your name is required";
    if (!form.contactPhone.trim() && !form.contactEmail.trim()) e.contactEmail = "Please provide at least one contact method";
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
      setSubmitted({ secretCode, title: newItem.title });
    } catch (error) {
      setSubmitError(getStorageErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="form-section">
        <div className="success-banner" role="status">
          <h3>🎉 Item Listed!</h3>
          <p>
            <strong>“{submitted.title}”</strong> is now live in the Used Uniform Shop.<br />
            Save your secret code — you'll need it to edit or mark your item as sold.
          </p>
          <div className="secret">{submitted.secretCode}</div>
          <p style={{ marginTop: 10, fontSize: 12 }}>Screenshot this code and keep it safe. It cannot be recovered later.</p>
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
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="listing-size">Size <span className="req">*</span></label>
          <select id="listing-size" className="form-select" value={form.size} onChange={e => set("size", e.target.value)}>
            <option value="">— Select —</option>
            {SIZES.map(s => <option key={s}>{s}</option>)}
          </select>
          {errors.size && <div className="error-msg">{errors.size}</div>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="listing-color">Colour</label>
          <select id="listing-color" className="form-select" value={form.color} onChange={e => set("color", e.target.value)}>
            <option value="">— Select —</option>
            {COLORS.map(c => <option key={c}>{c}</option>)}
          </select>
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
        <div className="form-label" style={{ fontSize: 14, color: "#C8102E", marginBottom: 14 }}>Your Contact Details</div>
      </div>

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
          After submitting, you'll receive an {CODE_LENGTH}-character code. When your item sells, enter this code on the listing to edit or remove it from the shop. Keep it safe — we can't recover lost codes.
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
                    <strong style={{ color: "#fff" }}>{l.title}</strong>
                    {l.brand && <small>{l.brand}</small>}
                  </td>
                  <td>{l.equipmentType || "—"}</td>
                  <td>{l.size || "—"}</td>
                  <td style={{ color: "#D4A843", fontWeight: 700 }}>{formatPrice(l.price)}</td>
                  <td>{l.contactName}</td>
                  <td>
                    {l.contactPhone && <small>📱 {l.contactPhone}</small>}
                    {l.contactEmail && <small>✉️ {l.contactEmail}</small>}
                  </td>
                  <td style={{ color: "#4A6070", fontSize: 12 }}>
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
    { base: "#1E3A8A", stripe: "#C8102E" },      // Blue with red stripe
    { base: "#C8102E", stripe: null },           // Red
    { base: "#C8102E", stripe: "#1A1A1A" },      // Red with black stripe
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
          aria-label="Phoenix Taekwondo logo"
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>🥋</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", lineHeight: 1.2 }}>
              PHOENIX <span style={{ color: "#C8102E" }}>TAEKWONDO</span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "#6B7E93", lineHeight: 1.2, textTransform: "uppercase" }}>
              (Used Uniform Shop, Run by Parents)
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
          <div className="hero">
            <div className="hero-stripe" />
            <h1>Phoenix Taekwondo<br /><em>Used Uniform Shop</em></h1>
            <p className="hero-sub">Buy and sell used taekwondo uniforms and equipment — doboks, body armour, and more — within the club community.</p>
            <div className="hero-actions">
              <button className="btn btn-primary" type="button" onClick={() => setTab("sell")}>List an Item</button>
              <button className="btn btn-ghost" type="button" onClick={() => document.getElementById("listings")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Browse Listings</button>
            </div>
            <div className="hero-belt-row">
              {beltColors.map((belt, i) => (
                <div key={i} className="belt-chip" style={{
                  background: belt.stripe
                    ? `linear-gradient(to bottom, ${belt.base} 60%, ${belt.stripe} 60%)`
                    : belt.base,
                  opacity: belt.base === "#FFFFFF" ? 0.85 : 1,
                  border: belt.base === "#FFFFFF" ? "1px solid rgba(255,255,255,0.25)" : "none",
                }} />
              ))}
            </div>
          </div>

          <div className="store-section" id="listings">
            <div className="store-header">
              <div className="store-title">
                Current Listings
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
                  <p style={{ color: "#4A6070", fontSize: 18, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, textTransform: "uppercase" }}>No listings yet</p>
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
