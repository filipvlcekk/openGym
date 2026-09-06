const candidates = [
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/server/streamable-http.js',
  '@modelcontextprotocol/sdk/server/http.js',
  '@modelcontextprotocol/sdk/server/mcp.js'
];

for (const specifier of candidates) {
  try {
    const mod = await import(specifier);
    console.log(specifier, Object.keys(mod).sort().join(', '));
  } catch (error) {
    console.log(specifier, 'ERROR', error.code || error.message);
  }
}
