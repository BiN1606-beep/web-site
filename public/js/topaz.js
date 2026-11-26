// Topaz: crystals you get from orbs and spend on streak freezes.
//
// Orbs are the only reward. Every finished daily task (your check-in, or a
// check-in on a shared goal) gives one orb. You tap it open and it gives
// 20 to 100 topaz. The server decides the amount when the orb is made and
// pays it when you open it (db/migrations/016_topaz_orbs.sql,
// lua/osiris/topaz.lua); this page only shows it.
//
// This file draws:
//  * the topaz crystal icon used everywhere,
//  * the topaz counter and the waiting-orb button on the Today tab,
//  * the orb opening (tap, tap, tap, burst, collect),
//  * the orb shelf on the Progress tab (the last 7 days),
//  * the little shop where you buy a streak freeze.
//
// Loaded as a plain script after streak.js (see the list at the end of
// index.html); renderStreak calls renderTopaz.

// ---- Pure helpers (tested by tests/unit/topaz_test.mjs) ----

// The orb shelf: the last 7 days up to today, oldest first. Each day says
// how much its opened orbs gave and which of its orbs are still closed.
const orbShelfDays = (recentOrbs, today) => {
  const orbs = Array.isArray(recentOrbs) ? recentOrbs : [];
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    const mine = orbs.filter((orb) => orb && orb.day === day);
    days.push({
      day,
      topaz: mine.reduce((sum, orb) => sum + (orb.opened ? Number(orb.amount) || 0 : 0), 0),
      opened: mine.filter((orb) => orb.opened).length,
      waiting: mine.filter((orb) => !orb.opened).map((orb) => orb.id),
    });
  }
  return days;
};

// How many crystals burst out of an orb: more for a bigger amount.
const orbGemCount = (amount) => Math.max(3, Math.min(12, Math.round(amount / 9)));

// ---- end of pure helpers ----

// The topaz crystal: a natural cluster, one big crystal and a small one
// behind it, with a rainbow where light splits inside it and a rainbow
// glint on one edge, like a prism. Each copy gets its own ids for its
// rainbow and clip path, so copies never borrow from a hidden one.
let topazIconCount = 0;
const topazSvg = () => {
  topazIconCount += 1;
  const id = `tz${topazIconCount}`;
  return `
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${id}-rainbow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff6b6b"/><stop offset="0.22" stop-color="#ffb347"/>
        <stop offset="0.42" stop-color="#ffe45c"/><stop offset="0.6" stop-color="#6ee7a0"/>
        <stop offset="0.8" stop-color="#62b0ff"/><stop offset="1" stop-color="#b98bff"/>
      </linearGradient>
      <clipPath id="${id}-face"><path d="M16 11L22.5 10.5 21 29.5 14 30.5z"/></clipPath>
    </defs>
    <path class="topaz-dark" d="M1.5 15L5 16.5 6 28 2.5 26.5z"/>
    <path class="topaz-mid" d="M5 16.5L10 14.5 10 27 6 28z"/>
    <path class="topaz-light" d="M3.5 10L1.5 15 5 16.5z"/>
    <path class="topaz-shine" d="M3.5 10L5 16.5 10 14.5z"/>
    <path class="topaz-edge" d="M3.5 10L10 14.5 10 27 6 28 2.5 26.5 1.5 15z M1.5 15L5 16.5 10 14.5 M5 16.5L6 28"/>
    <path class="topaz-mid" d="M11 8.5L16 11 14 30.5 9 27.5z"/>
    <path class="topaz-face" d="M16 11L22.5 10.5 21 29.5 14 30.5z"/>
    <path class="topaz-dark" d="M22.5 10.5L26 6.5 24.5 25.5 21 29.5z"/>
    <path class="topaz-light" d="M19 1.5L11 8.5 16 11z"/>
    <path class="topaz-shine" d="M19 1.5L16 11 22.5 10.5z"/>
    <path class="topaz-face" d="M19 1.5L22.5 10.5 26 6.5z"/>
    <g clip-path="url(#${id}-face)" opacity="0.9">
      <path d="M15 13.5L24 19.5 24 27.5z" fill="url(#${id}-rainbow)"/>
    </g>
    <path class="topaz-ray" d="M11.5 13.5l4.3 1.2"/>
    <path class="topaz-edge" d="M19 1.5L26 6.5 24.5 25.5 21 29.5 14 30.5 9 27.5 11 8.5z M11 8.5L16 11 22.5 10.5 26 6.5 M16 11L19 1.5 22.5 10.5 M16 11L14 30.5 M22.5 10.5L21 29.5"/>
    <path class="topaz-glint" d="M20 3L25 6.6" stroke="url(#${id}-rainbow)"/>
  </svg>`;
};

// A six-armed ice crystal for streak freezes.
const FREEZE_SVG = `
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <g class="freeze-arms">
      <path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13"/>
      <path d="M12.5 5.5L16 9l3.5-3.5M12.5 26.5L16 23l3.5 3.5M3.9 14l4.8-1.3-1.3-4.8M28.1 18l-4.8 1.3 1.3 4.8M7.4 23.6l1.3-4.8L3.9 17.5M24.6 8.4l-1.3 4.8 4.8 1.3"/>
    </g>
  </svg>`;

const topazIcon = (className = "topaz-icon") => {
  const icon = document.createElement("span");
  icon.className = className;
  icon.innerHTML = topazSvg();
  return icon;
};

const freezeIcon = (className = "freeze-icon") => {
  const icon = document.createElement("span");
  icon.className = className;
  icon.innerHTML = FREEZE_SVG;
  return icon;
};

// An orb: a glowing glass ball with a crystal inside and a slow rainbow
// swirl. "mini" is the small one on buttons and the shelf.
const orbElement = (className = "orb") => {
  const orb = document.createElement("span");
  orb.className = className;
  const swirl = document.createElement("span");
  swirl.className = "orb-swirl";
  const core = topazIcon("topaz-icon orb-core");
  const shine = document.createElement("span");
  shine.className = "orb-shine";
  orb.append(swirl, core, shine);
  return orb;
};

const topazReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- The counter and the orb button on the Today tab ----
// Created here instead of in index.html, so everything about topaz lives
// in this file and topaz.css.
const orbChip = document.createElement("button");
orbChip.type = "button";
orbChip.className = "orb-chip";
orbChip.hidden = true;
const orbChipCount = document.createElement("b");
orbChip.append(orbElement("orb orb-mini"), orbChipCount);

const topazChip = document.createElement("button");
topazChip.type = "button";
topazChip.className = "topaz-chip";
topazChip.hidden = true;
const topazChipCount = document.createElement("b");
topazChipCount.textContent = "0";
topazChip.append(topazIcon(), topazChipCount);
document.querySelector(".checkin-streak")?.append(orbChip, topazChip);

// The orb shelf on the Progress tab (its card is in index.html).
const orbCard = document.querySelector("#orb-card");
const orbShelf = document.querySelector("#orb-shelf");
const orbCardWeek = document.querySelector("#orb-card-week");

// The wallet last drawn; null until the first draw, so orbs you already
// had don't pop open by themselves on page load.
let topazState = null;
let topazStreak = null;

// Counts a number up or down to its new value.
const topazCountTo = (element, to, duration = 600) => {
  const from = Number(element.textContent) || 0;
  if (from === to || topazReducedMotion()) {
    element.textContent = String(to);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const topazBump = (element) => {
  element.classList.remove("is-bumping");
  void element.offsetWidth;
  element.classList.add("is-bumping");
};

// Crystals flying in an arc from one rectangle to another.
const topazFly = (from, to, count, parent = document.body, className = "") => {
  if (topazReducedMotion() || !to.width) return;
  for (let index = 0; index < count; index += 1) {
    const gem = topazIcon(`topaz-icon topaz-flyer ${className}`);
    const startX = from.left + from.width / 2 + (Math.random() - 0.5) * from.width * 0.6;
    const startY = from.top + from.height / 2 + (Math.random() - 0.5) * from.height * 0.6;
    gem.style.left = `${startX}px`;
    gem.style.top = `${startY}px`;
    gem.style.setProperty("--dx", `${to.left + to.width / 2 - startX}px`);
    gem.style.setProperty("--dy", `${to.top + to.height / 2 - startY}px`);
    gem.style.setProperty("--arc", `${-30 - Math.random() * 60}px`);
    gem.style.animationDelay = `${index * 60}ms`;
    parent.append(gem);
    window.setTimeout(() => gem.remove(), 1000 + index * 60);
  }
};

const drawOrbChip = (topaz) => {
  const waiting = topaz.orbs?.length || 0;
  orbChip.hidden = waiting === 0;
  orbChipCount.textContent = waiting > 1 ? String(waiting) : "";
  orbChip.setAttribute("aria-label", waiting === 1 ? "Open your orb" : `Open your ${waiting} orbs`);
};

const drawOrbShelf = (topaz) => {
  if (!orbCard) return;
  orbCard.hidden = false;
  const today = localDay();
  const days = orbShelfDays(topaz.recent_orbs, today);
  const week = days.reduce((sum, day) => sum + day.topaz, 0);
  orbCardWeek.replaceChildren(document.createTextNode(`+${week}`), topazIcon());
  orbCardWeek.setAttribute("aria-label", `${week} topaz from orbs in the last 7 days`);
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  orbShelf.replaceChildren(...days.map((day) => {
    const item = document.createElement("li");
    item.className = "orb-day";
    item.classList.toggle("is-today", day.day === today);
    let slot;
    if (day.waiting.length) {
      slot = document.createElement("button");
      slot.type = "button";
      slot.className = "orb-slot is-waiting";
      slot.setAttribute("aria-label", "Open this orb");
      slot.append(orbElement("orb orb-mini"));
      slot.addEventListener("click", () => openOrbDialog(day.waiting[0]));
    } else {
      slot = document.createElement("span");
      slot.className = "orb-slot";
      if (day.opened) {
        slot.classList.add("is-opened");
        slot.append(topazIcon());
        slot.setAttribute("aria-label", `${day.day}: ${day.topaz} topaz`);
      } else {
        slot.setAttribute("aria-label", `${day.day}: no orb`);
      }
    }
    const amount = document.createElement("b");
    amount.textContent = day.opened ? String(day.topaz) : "";
    const name = document.createElement("span");
    name.textContent = names[new Date(`${day.day}T12:00:00`).getDay()];
    item.append(slot, amount, name);
    return item;
  }));
};

// Called by renderStreak with tree.topaz and the streak it just worked out.
const renderTopaz = (topaz, streak) => {
  if (!topaz || typeof topaz.balance !== "number") {
    topazChip.hidden = true;
    orbChip.hidden = true;
    if (orbCard) orbCard.hidden = true;
    return;
  }
  if (streak) topazStreak = streak;
  const previous = topazState;
  topazState = topaz;
  topazChip.hidden = false;
  topazChip.setAttribute("aria-label", `${topaz.balance} topaz. Open the shop`);
  topazCountTo(topazChipCount, topaz.balance);
  drawOrbChip(topaz);
  drawOrbShelf(topaz);
  if (topazShop.open) drawTopazShop();
  // A new orb since the last draw: it drops in, then opens up big.
  const known = new Set((previous?.orbs || []).map((orb) => orb.id));
  const fresh = previous ? (topaz.orbs || []).filter((orb) => !known.has(orb.id)) : [];
  if (fresh.length) {
    topazBump(orbChip);
    orbChip.classList.add("is-new");
    window.setTimeout(() => orbChip.classList.remove("is-new"), 900);
    window.setTimeout(() => openOrbDialog(fresh[0].id), topazReducedMotion() ? 0 : 650);
  }
};

// A shared-goal check-in answers with the new wallet (community.js).
const applyTopazFromCommunity = (topaz) => {
  if (!topaz || typeof topaz.balance !== "number" || !progressTreeState) return;
  progressTreeState.topaz = topaz;
  renderTopaz(topaz, topazStreak);
};

// ---- Opening an orb ----
// Tap three times: it wobbles, cracks, and bursts. The first tap already
// asks the server to open it, so the amount is there by the third tap.
const TAPS_TO_OPEN = 3;

const orbDialog = document.createElement("dialog");
orbDialog.className = "orb-dialog";
orbDialog.setAttribute("aria-label", "Open your orb");
document.body.append(orbDialog);

// The orb on stage: { id, taps, request, done }.
let orbOpening = null;

const orbCrackSvg = `
  <svg class="orb-cracks" viewBox="0 0 100 100" aria-hidden="true">
    <path class="orb-crack orb-crack-1" d="M50 8l-4 14 7 8-5 12"/>
    <path class="orb-crack orb-crack-2" d="M53 30l12 6 4 12M48 42l-12 8-3 13 6 9"/>
  </svg>`;

const drawOrbDialog = () => {
  const topaz = topazState;
  if (!topaz) return;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "orb-dialog-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeOrbDialog);

  const wallet = document.createElement("span");
  wallet.className = "orb-wallet";
  const walletCount = document.createElement("b");
  walletCount.textContent = String(topaz.balance);
  wallet.append(topazIcon(), walletCount);

  const stage = document.createElement("div");
  stage.className = "orb-stage";
  const rays = document.createElement("span");
  rays.className = "orb-rays";
  const orbButton = document.createElement("button");
  orbButton.type = "button";
  orbButton.className = "orb-button";
  orbButton.setAttribute("aria-label", "Tap to open the orb");
  const orb = orbElement("orb orb-big");
  orb.insertAdjacentHTML("beforeend", orbCrackSvg);
  orbButton.append(orb);
  orbButton.addEventListener("click", tapOrb);
  stage.append(rays, orbButton);

  // Three dots: how many taps are left.
  const taps = document.createElement("div");
  taps.className = "orb-taps";
  taps.setAttribute("aria-hidden", "true");
  for (let index = 0; index < TAPS_TO_OPEN; index += 1) taps.append(document.createElement("span"));

  const amount = document.createElement("p");
  amount.className = "orb-amount";
  amount.setAttribute("role", "status");
  amount.hidden = true;

  const collect = document.createElement("button");
  collect.type = "button";
  collect.className = "save-button game-button orb-collect";
  collect.textContent = "Collect";
  collect.hidden = true;
  collect.addEventListener("click", collectOrb);

  // The other closed orbs, waiting in a row.
  const queue = document.createElement("div");
  queue.className = "orb-queue";
  const others = (topaz.orbs || []).filter((item) => item.id !== orbOpening?.id);
  for (let index = 0; index < Math.min(others.length, 6); index += 1) queue.append(orbElement("orb orb-mini"));

  const status = document.createElement("p");
  status.className = "orb-status";
  status.setAttribute("role", "alert");

  orbDialog.replaceChildren(close, wallet, stage, taps, amount, collect, queue, status);
};

const openOrbDialog = (orbId) => {
  const topaz = topazState;
  if (!topaz || !topaz.orbs?.length) return;
  // Already opening one: leave it be.
  if (orbDialog.open && orbOpening && !orbOpening.done) return;
  const orb = topaz.orbs.find((item) => item.id === orbId) || topaz.orbs[0];
  orbOpening = { id: orb.id, taps: 0, request: null, done: false };
  drawOrbDialog();
  orbDialog.classList.remove("is-closing");
  if (!orbDialog.open) orbDialog.showModal();
  orbDialog.querySelector(".orb-button")?.focus();
};

const tapOrb = async () => {
  const opening = orbOpening;
  if (!opening || opening.done || opening.taps >= TAPS_TO_OPEN) return;
  opening.taps += 1;
  const orb = orbDialog.querySelector(".orb-big");
  const dots = orbDialog.querySelectorAll(".orb-taps span");
  dots[opening.taps - 1]?.classList.add("is-done");
  orbDialog.querySelector(".orb-status").textContent = "";
  if (!opening.request) {
    opening.request = fetch("/api/progress-tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open_orb", orbId: String(opening.id) }),
    }).then(async (response) => {
      const result = await readApiResponse(response, "Orb");
      if (!response.ok) {
        const error = new Error(result.error || "Could not open the orb.");
        error.topaz = result.topaz;
        throw error;
      }
      return result;
    });
    // Handled on the last tap; this only keeps the browser from warning.
    opening.request.catch(() => {});
  }
  orb.dataset.crack = String(opening.taps);
  orb.classList.remove("is-tapped");
  void orb.offsetWidth;
  orb.classList.add("is-tapped");
  if (opening.taps < TAPS_TO_OPEN) return;

  try {
    const result = await opening.request;
    burstOrb(result.amount, result.topaz);
  } catch (error) {
    // Nothing was paid (or it was already open): show the fresh wallet
    // and let them try again.
    if (error.topaz && progressTreeState) {
      progressTreeState.topaz = error.topaz;
      renderTopaz(error.topaz, topazStreak);
    }
    orbOpening = null;
    if (topazState?.orbs?.length) {
      openOrbDialog(topazState.orbs[0].id);
      orbDialog.querySelector(".orb-status").textContent = error.message;
    } else {
      closeOrbDialog();
    }
  }
};

const burstOrb = (amount, topaz) => {
  const opening = orbOpening;
  opening.done = true;
  opening.amount = amount;
  opening.topaz = topaz;
  const stage = orbDialog.querySelector(".orb-stage");
  const orb = orbDialog.querySelector(".orb-big");
  const tier = amount >= 100 ? "is-max" : amount >= 80 ? "is-rare" : "";
  if (tier) stage.classList.add(tier);
  stage.classList.add("is-burst");
  orbDialog.querySelector(".orb-taps").hidden = true;
  const still = topazReducedMotion();

  if (!still) {
    // The glass breaks into pieces that fly away.
    for (let index = 0; index < 10; index += 1) {
      const shard = document.createElement("span");
      shard.className = "orb-shard";
      const angle = (index / 10) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 90 + Math.random() * 70;
      shard.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
      shard.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
      shard.style.setProperty("--r", `${Math.random() * 540 - 270}deg`);
      stage.append(shard);
    }
    // Sparks of light in rainbow colors.
    for (let index = 0; index < 14; index += 1) {
      const spark = document.createElement("span");
      spark.className = "orb-spark";
      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 110;
      spark.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
      spark.style.setProperty("--hue", `${Math.round(Math.random() * 300)}`);
      spark.style.animationDelay = `${Math.random() * 120}ms`;
      stage.append(spark);
    }
  }
  // The crystals that were inside, floating around where the orb was.
  const count = orbGemCount(amount);
  for (let index = 0; index < count; index += 1) {
    const gem = topazIcon("topaz-icon orb-gem");
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const distance = count > 1 ? 52 + (index % 2) * 22 : 0;
    gem.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    gem.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    gem.style.setProperty("--spin", `${Math.random() * 60 - 30}deg`);
    gem.style.animationDelay = `${120 + index * 40}ms, ${900 + index * 90}ms`;
    stage.append(gem);
  }
  window.setTimeout(() => orb.remove(), still ? 0 : 160);

  // The amount counts up, then the Collect button.
  const amountText = orbDialog.querySelector(".orb-amount");
  amountText.className = `orb-amount ${tier}`;
  const number = document.createElement("b");
  number.textContent = "0";
  amountText.replaceChildren(document.createTextNode("+"), number, topazIcon());
  amountText.setAttribute("aria-label", `${amount} topaz`);
  amountText.hidden = false;
  window.setTimeout(() => topazCountTo(number, amount, 900), still ? 0 : 250);
  const collect = orbDialog.querySelector(".orb-collect");
  window.setTimeout(() => {
    collect.hidden = false;
    collect.focus();
  }, still ? 0 : 900);
};

const collectOrb = () => {
  const opening = orbOpening;
  if (!opening?.done) return;
  const collect = orbDialog.querySelector(".orb-collect");
  collect.disabled = true;
  // The crystals fly into the counter at the top.
  const wallet = orbDialog.querySelector(".orb-wallet");
  const walletCount = wallet.querySelector("b");
  const target = wallet.querySelector(".topaz-icon").getBoundingClientRect();
  for (const gem of orbDialog.querySelectorAll(".orb-gem")) {
    topazFly(gem.getBoundingClientRect(), target, 1, orbDialog);
    gem.remove();
  }
  const still = topazReducedMotion();
  window.setTimeout(() => {
    topazCountTo(walletCount, opening.topaz.balance);
    topazBump(wallet);
  }, still ? 0 : 650);
  // The page catches up with the new wallet; then the next orb, if any.
  window.setTimeout(() => {
    orbOpening = null;
    if (progressTreeState) progressTreeState.topaz = opening.topaz;
    // Don't treat the orbs that are left as new.
    topazState = opening.topaz;
    renderTopaz(opening.topaz, topazStreak);
    topazBump(topazChip);
    const next = opening.topaz.orbs?.[0];
    if (next) {
      openOrbDialog(next.id);
      orbDialog.querySelector(".orb-big")?.classList.add("is-dropping");
    } else {
      closeOrbDialog();
    }
  }, still ? 0 : 1300);
};

const closeOrbDialog = () => {
  if (!orbDialog.open || orbDialog.classList.contains("is-closing")) return;
  // Closing after the burst still collects (the topaz is already paid).
  if (orbOpening?.done && orbOpening.topaz) {
    if (progressTreeState) progressTreeState.topaz = orbOpening.topaz;
    topazState = orbOpening.topaz;
    renderTopaz(orbOpening.topaz, topazStreak);
  }
  orbOpening = null;
  if (topazReducedMotion()) {
    orbDialog.close();
    return;
  }
  orbDialog.classList.add("is-closing");
  window.setTimeout(() => {
    orbDialog.classList.remove("is-closing");
    orbDialog.close();
  }, 180);
};

orbChip.addEventListener("click", () => openOrbDialog(topazState?.orbs?.[0]?.id));
orbDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeOrbDialog();
});

// ---- The shop ----
const topazShop = document.createElement("dialog");
topazShop.className = "topaz-shop";
topazShop.setAttribute("aria-label", "Topaz shop");
document.body.append(topazShop);

const drawTopazShop = () => {
  const topaz = topazState;
  if (!topaz) return;
  const streak = topazStreak || { freezes: 0, boughtFreezes: 0 };
  const price = topaz.freeze_price || 400;
  const maxBought = topaz.max_bought || 3;
  const full = streak.boughtFreezes >= maxBought;
  const poor = topaz.balance < price;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "topaz-shop-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeTopazShop);

  // The big crystal and how many you have.
  const wallet = document.createElement("div");
  wallet.className = "topaz-wallet";
  const count = document.createElement("b");
  count.className = "topaz-wallet-count";
  count.textContent = String(topaz.balance);
  const name = document.createElement("span");
  name.textContent = "topaz";
  wallet.append(topazIcon("topaz-icon topaz-big"), count, name);

  // The freeze for sale, with your freeze slots.
  const card = document.createElement("section");
  card.className = "topaz-offer";
  const title = document.createElement("h3");
  title.textContent = "Streak freeze";
  const slots = document.createElement("div");
  slots.className = "freeze-slots";
  slots.setAttribute("aria-label", `${streak.boughtFreezes} of ${maxBought} bought freezes`);
  for (let index = 0; index < maxBought; index += 1) {
    const slot = freezeIcon("freeze-icon freeze-slot");
    slot.classList.toggle("is-filled", index < streak.boughtFreezes);
    slots.append(slot);
  }
  const help = document.createElement("p");
  help.className = "topaz-offer-help";
  help.textContent = streak.freezes
    ? `Saves your streak on a missed day. Plus ${streak.freezes} free from your streak.`
    : "Saves your streak on a missed day.";

  const buy = document.createElement("button");
  buy.type = "button";
  buy.className = "save-button game-button topaz-buy";
  buy.disabled = full || poor;
  if (full) {
    buy.textContent = "All slots full";
  } else {
    buy.append(document.createTextNode("Buy for "), topazIcon(), document.createTextNode(String(price)));
  }
  buy.addEventListener("click", () => buyFreeze(buy, slots));

  // How close you are to the next one.
  const meter = document.createElement("div");
  meter.className = "topaz-meter";
  meter.hidden = full || !poor;
  const fill = document.createElement("span");
  fill.style.setProperty("--fill", `${Math.min(1, topaz.balance / price)}`);
  meter.append(fill);
  meter.setAttribute("aria-label", `${topaz.balance} of ${price} topaz`);

  const status = document.createElement("p");
  status.className = "topaz-status";
  status.setAttribute("role", "status");
  card.append(freezeIcon("freeze-icon freeze-hero"), title, slots, help, meter, buy, status);

  // How to get orbs: two rows, little text.
  const earn = document.createElement("ul");
  earn.className = "topaz-earn";
  const range = `${topaz.orb_min || 20}–${topaz.orb_max || 100}`;
  for (const [label, done] of [
    ["Daily check-in", Boolean(streak.checkedInToday)],
    [`Shared goals (up to ${topaz.max_shared_per_day || 3} a day)`, false],
  ]) {
    const row = document.createElement("li");
    row.classList.toggle("is-done", done);
    const text = document.createElement("span");
    text.textContent = label;
    const reward = document.createElement("b");
    reward.append(orbElement("orb orb-mini"), document.createTextNode(range), topazIcon());
    row.append(text, reward);
    earn.append(row);
  }

  topazShop.replaceChildren(close, wallet, card, earn);
};

const buyFreeze = async (button) => {
  button.disabled = true;
  const status = topazShop.querySelector(".topaz-status");
  const before = topazStreak?.boughtFreezes || 0;
  try {
    // postProgressTree (goals.js) redraws everything, which also redraws
    // this shop; the animation runs on the fresh slots afterwards.
    await postProgressTree({ action: "buy_freeze", day: localDay() });
    const filled = topazShop.querySelectorAll(".freeze-slot")[before];
    if (filled) {
      filled.classList.add("is-new");
      // Crystals fly out of the wallet into the slot.
      topazFly(topazShop.querySelector(".topaz-big").getBoundingClientRect(),
        filled.getBoundingClientRect(), 6, topazShop, "is-spending");
    }
    topazBump(topazChip);
  } catch (error) {
    const fresh = topazShop.querySelector(".topaz-status") || status;
    fresh.textContent = error.message;
  }
};

const openTopazShop = () => {
  drawTopazShop();
  if (!topazShop.open) topazShop.showModal();
};

const closeTopazShop = () => {
  if (!topazShop.open || topazShop.classList.contains("is-closing")) return;
  if (topazReducedMotion()) {
    topazShop.close();
    return;
  }
  topazShop.classList.add("is-closing");
  window.setTimeout(() => {
    topazShop.classList.remove("is-closing");
    topazShop.close();
  }, 180);
};

topazChip.addEventListener("click", openTopazShop);
topazShop.addEventListener("click", (event) => {
  if (event.target === topazShop) closeTopazShop();
});
topazShop.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTopazShop();
});
