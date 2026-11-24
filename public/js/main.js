// Starts the page. Loaded last, so everything it calls exists.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

mainPage.inert = true;
loadAccount();
// The progress tree is the home page, so load it right away.
loadProgressTree();
