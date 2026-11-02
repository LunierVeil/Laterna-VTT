import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Capture the existing app socket only; do not intercept messages or change seq handling.
export async function observeTokenLink(page, tokenId) {
  await page.evaluate(async tokenId => {
    const { SceneSocket } = await import('/src/net/socket.ts');
    const original = SceneSocket.prototype.send;
    SceneSocket.prototype.send = function(name, payload, ...rest) {
      if (name === 'token.update' && payload.id === tokenId) {
        window.tokenLinkSocket = this;
        SceneSocket.prototype.send = original;
      }
      return original.call(this, name, payload, ...rest);
    };
  }, tokenId);
  return page.received.length;
}

export async function tokenLinkClientState(page, tokenId) {
  return page.evaluate(async tokenId => {
    const { useUi } = await import('/src/state/store.ts');
    const stage = window.observedStage;
    return {
      socketSequence: window.tokenLinkSocket?.sequence ?? null,
      stageAlive: stage?.isAlive ?? false,
      stageToken: stage?.tokens.get(tokenId)?.data ?? null,
      selected: useUi.getState().selected,
      comboboxCount: document.querySelectorAll('select[aria-label="Персонаж токена"]').length,
    };
  }, tokenId);
}

export function matchingLinkUpdate(messages, tokenId, characterId) {
  return messages.find(message =>
    (message.type === 'event' && message.name === 'token.updated' &&
      message.payload.token.id === tokenId && message.payload.token.character_id === characterId) ||
    (message.type === 'snapshot' && message.scene.tokens.some(token =>
      token.id === tokenId && token.character_id === characterId)));
}

export async function saveTokenLinkFailure(page, loadScene, tokenId, characterId, receivedStart, error) {
  const server = await loadScene().then(scene => ({
    id: scene.id, seq: scene.seq, token: scene.tokens.find(token => token.id === tokenId) ?? null,
  })).catch(error => ({ error: String(error) }));
  const client = await tokenLinkClientState(page, tokenId).catch(error => ({ error: String(error) }));
  const received = page.received.slice(receivedStart).map(message => ({
    type: message.type, name: message.name, seq: message.seq, cmd_id: message.cmd_id,
    token: message.payload?.token?.id === tokenId ? message.payload.token :
      message.type === 'snapshot' ? message.scene.tokens.find(token => token.id === tokenId) : undefined,
    message: message.type === 'error' ? message.message : undefined,
  }));
  const out = process.env.BROWSER_RESULTS_DIR || resolve(tmpdir(), 'laterna-browser-results', 'tokens');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'alpha-token-link-failure.json'), JSON.stringify({
    tokenId, characterId, error: String(error), stack: error?.stack, server, received, client,
  }, null, 2));
}
