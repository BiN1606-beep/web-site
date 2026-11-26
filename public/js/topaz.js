// Topaz: yellow gems you earn by checking in and spend on streak freezes.
//
// The server pays out the gems (once per check-in per day, see
// db/migrations/015_topaz_gems.sql) and sends the wallet with the
// progress tree as tree.topaz. This file draws the gem counter on the
// Today tab, the little shop where you buy a freeze, and the animations.
//
// Loaded as a plain script after streak.js (see the list at the end of
// index.html); renderStreak calls renderTopaz.

const TOPAZ_SVG = `
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path class="topaz-facet-top" d="M9 4h14l7 8H2z"/>
    <path class="topaz-facet-left" d="M2 12h10l4 17z"/>
    <path class="topaz-facet-mid" d="M12 12h8l-4 17z"/>
    <path class="topaz-facet-right" d="M20 12h10L16 29z"/>
    <path class="topaz-facet-crown" d="M12 12l4-8 4 8z"/>
    <path class="topaz-edge" d="M9 4h14l7 8-14 17L2 12z"/>
  </svg>`;

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
  icon.innerHTML = TOPAZ_SVG;
  return icon;
};

const freezeIcon = (className = "freeze-icon") => {
  const icon = document.createElement("span");
  icon.className = className;
  icon.innerHTML = FREEZE_SVG;
  return icon;
};

const topazReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- The gem counter on the Today tab ----
// Created here instead of in index.html, so everything about topaz lives
// in this file and topaz.css.
const topazChip = document.createElement("button");
topazChip.type = "button";
topazChip.className = "topaz-chip";
topazChip.hidden = true;
const topazChipCount = document.createElement("b");
topazChipCount.textContent = "0";
topazChip.append(topazIcon(), topazChipCount);
document.querySelector(".checkin-streak")?.append(topazChip);

// The wallet last drawn; null until the first draw, so the gems you
// already had don't fly in on page load.
let topazState = null;
let topazStreak = null;

// Counts a number up or down to its new value.
const topazCountTo = (element, to) => {
  const from = Number(element.textContent) || 0;
  if (from === to || topazReducedMotion()) {
    element.textContent = String(to);
    return;
  }
  const started = performance.now();
  const duration = 600;
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

// "+10" with a gem, rising from a spot on the page. origin is an element
// (the button you pressed); without one it rises from the gem counter.
const topazPop = (amount, origin) => {
  const from = (origin && origin.isConnected ? origin : topazChip).getBoundingClientRect();
  const pop = document.createElement("span");
  pop.className = "topaz-pop";
  pop.append(document.createTextNode(`+${amount}`), topazIcon());
  pop.style.left = `${from.left + from.width / 2}px`;
  pop.style.top = `${from.top}px`;
  document.body.append(pop);
  window.setTimeout(() => pop.remove(), 1400);
  if (topazReducedMotion()) return;
  // A few small gems fly from there to the counter.
  const to = topazChip.getBoundingClientRect();
  if (topazChip.hidden || !to.width) return;
  for (let index = 0; index < 5; index += 1) {
    const gem = topazIcon("topaz-icon topaz-flyer");
    gem.style.left = `${from.left + from.width / 2}px`;
    gem.style.top = `${from.top + from.height / 2}px`;
    gem.style.setProperty("--dx", `${to.left + to.width / 4 - from.left - from.width / 2}px`);
    gem.style.setProperty("--dy", `${to.top + to.height / 2 - from.top - from.height / 2}px`);
    gem.style.setProperty("--arc", `${-40 - Math.random() * 60}px`);
    gem.style.animationDelay = `${index * 70}ms`;
    document.body.append(gem);
    window.setTimeout(() => gem.remove(), 1100 + index * 70);
  }
};

// Called by renderStreak with tree.topaz and the streak it just worked out.
const renderTopaz = (topaz, streak) => {
  if (!topaz || typeof topaz.balance !== "number") {
    topazChip.hidden = true;
    return;
  }
  topazStreak = streak;
  const previous = topazState;
  topazState = topaz;
  topazChip.hidden = false;
  topazChip.setAttribute("aria-label", `${topaz.balance} topaz. Open the gem shop`);
  if (previous && topaz.balance > previous.balance) {
    // Earned: the counter waits a moment for the flying gems.
    // They rise from the check-in button, right below the counter.
    topazPop(topaz.balance - previous.balance, checkinButton);
    window.setTimeout(() => {
      topazCountTo(topazChipCount, topaz.balance);
      topazBump(topazChip);
    }, topazReducedMotion() ? 0 : 650);
  } else {
    topazCountTo(topazChipCount, topaz.balance);
  }
  if (topazShop.open) drawTopazShop();
};

// A shared-goal check-in answers with the new wallet (community.js).
const applyTopazFromCommunity = (topaz, origin) => {
  if (!topaz || typeof topaz.balance !== "number" || !progressTreeState) return;
  const earned = topazState ? topaz.balance - topazState.balance : 0;
  progressTreeState.topaz = topaz;
  if (earned > 0) {
    // Show the "+10" where you checked in; the counter on the Today tab
    // catches up quietly.
    topazPop(earned, origin);
    topazState = topaz;
    topazCountTo(topazChipCount, topaz.balance);
  } else {
    renderTopaz(topaz, topazStreak);
  }
};

// ---- The gem shop ----
const topazShop = document.createElement("dialog");
topazShop.className = "topaz-shop";
topazShop.setAttribute("aria-label", "Gem shop");
document.body.append(topazShop);

const drawTopazShop = () => {
  const topaz = topazState;
  if (!topaz) return;
  const streak = topazStreak || { freezes: 0, boughtFreezes: 0 };
  const price = topaz.freeze_price || 70;
  const maxBought = topaz.max_bought || 3;
  const full = streak.boughtFreezes >= maxBought;
  const poor = topaz.balance < price;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "topaz-shop-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeTopazShop);

  // The big gem and how many you have.
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

  // How to earn more: two rows, little text.
  const earn = document.createElement("ul");
  earn.className = "topaz-earn";
  const perCheckin = topaz.per_checkin || 10;
  for (const [label, done] of [
    ["Daily check-in", Boolean(streak.checkedInToday)],
    [`Shared goals (up to ${topaz.max_shared_per_day || 3} a day)`, false],
  ]) {
    const row = document.createElement("li");
    row.classList.toggle("is-done", done);
    const text = document.createElement("span");
    text.textContent = label;
    const reward = document.createElement("b");
    reward.append(document.createTextNode(`+${perCheckin}`), topazIcon());
    row.append(text, reward);
    earn.append(row);
  }

  topazShop.replaceChildren(close, wallet, card, earn);
};

const buyFreeze = async (button, slots) => {
  button.disabled = true;
  const status = topazShop.querySelector(".topaz-status");
  const before = topazStreak?.boughtFreezes || 0;
  try {
    // postProgressTree (goals.js) redraws everything, which also redraws
    // this shop; the animation runs on the fresh slots afterwards.
    await postProgressTree({ action: "buy_freeze", day: localDay() });
    const filled = topazShop.querySelectorAll(".freeze-slot")[before];
    if (filled && !topazReducedMotion()) {
      filled.classList.add("is-new");
      // Gems shatter out of the wallet into the slot.
      const from = topazShop.querySelector(".topaz-big").getBoundingClientRect();
      const to = filled.getBoundingClientRect();
      for (let index = 0; index < 6; index += 1) {
        const gem = topazIcon("topaz-icon topaz-flyer is-spending");
        gem.style.left = `${from.left + from.width / 2}px`;
        gem.style.top = `${from.top + from.height / 2}px`;
        gem.style.setProperty("--dx", `${to.left + to.width / 2 - from.left - from.width / 2}px`);
        gem.style.setProperty("--dy", `${to.top + to.height / 2 - from.top - from.height / 2}px`);
        gem.style.setProperty("--arc", `${-30 - Math.random() * 50}px`);
        gem.style.animationDelay = `${index * 60}ms`;
        topazShop.append(gem);
        window.setTimeout(() => gem.remove(), 1100 + index * 60);
      }
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
