// Reading answers from the server.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const readApiResponse = async (response, endpoint) => {
  const contentType = response.headers.get("Content-Type") || "";
  const isJson = contentType.toLowerCase().includes("application/json");
  if (response.status === 429 && !isJson) {
    throw new Error(`${endpoint} requests are temporarily rate-limited. Wait a minute, then retry.`);
  }
  if (!isJson) {
    if (response.status === 404) {
      throw new Error(`${endpoint} API was not found. The server may need the latest deployment.`);
    }
    if (response.status >= 500) {
      throw new Error(`${endpoint} returned a server error (HTTP ${response.status}) instead of JSON.`);
    }
    throw new Error(`${endpoint} returned a web page instead of JSON (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${endpoint} returned invalid JSON.`);
  }
};
