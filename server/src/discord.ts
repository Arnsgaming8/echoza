const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

console.log(`[Discord] WEBHOOK_URL set: ${!!WEBHOOK_URL}`);

export async function sendDiscordNotification(content: string, username?: string) {
  if (!WEBHOOK_URL) {
    console.log('[Discord] Skipping — no WEBHOOK_URL');
    return;
  }
  try {
    console.log(`[Discord] Sending: "${content}" as ${username || 'Echoza'}`);
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `@everyone ${content}`, username: username || 'Echoza' }),
    });
    console.log(`[Discord] Response: ${res.status} ${res.statusText}`);
  } catch (err) {
    console.error('[Discord] Error:', err);
  }
}
