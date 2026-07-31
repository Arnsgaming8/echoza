const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export async function sendDiscordNotification(content: string, username?: string) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `@everyone ${content}`, username: username || 'Echoza' }),
    });
  } catch (err) {
    console.error('[Discord] Error:', err);
  }
}
