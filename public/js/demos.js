// Developer demos in Settings: the shared text and the Groq chat.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const loadSharedText = async () => {
  try {
    const response = await fetch("/api/shared-text", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load shared text.");
    sharedTextInput.value = result.text;
    savedText.textContent = result.text || "(The shared text is empty.)";
  } catch (error) {
    savedText.textContent = "Shared text could not be loaded.";
    saveStatus.textContent = error.message;
  }
};

sharedTextForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  saveStatus.textContent = "Saving...";
  try {
    const response = await fetch("/api/shared-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sharedTextInput.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save shared text.");
    sharedTextInput.value = result.text;
    savedText.textContent = result.text || "(The shared text is empty.)";
    saveStatus.textContent = "Saved for everyone.";
  } catch (error) {
    saveStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

loadSharedText();

groqForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (new TextEncoder().encode(groqPrompt.value).length > 2000) {
    groqStatus.textContent = "Prompt must be 2000 bytes or fewer.";
    return;
  }
  groqSubmit.disabled = true;
  groqStatus.textContent = "Thinking...";
  groqAnswer.textContent = "";
  try {
    const response = await fetch("/api/groq-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: groqPrompt.value }),
    });
    let result;
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      result = await response.json();
    } else if (!response.ok) {
      throw new Error(response.status === 429
        ? "Too many requests. Try again shortly."
        : "Groq request failed.");
    } else {
      throw new Error("Groq returned an unexpected response.");
    }
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : result.error?.message;
      throw new Error(message || "Groq request failed.");
    }
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== "string") throw new Error("Groq returned an unexpected response.");
    groqAnswer.textContent = answer;
    groqStatus.textContent = "Response received.";
  } catch (error) {
    groqStatus.textContent = error.message;
  } finally {
    groqSubmit.disabled = false;
  }
});
