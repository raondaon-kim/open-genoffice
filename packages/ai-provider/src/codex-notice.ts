/**
 * Renderer-safe first-run guidance for the Codex default route: a new install
 * routes to codex / gpt-5.6-luna, but until the user signs in no Codex model is
 * listed, so panels would otherwise only say "the selected model is unavailable".
 */

export const CODEX_SIGN_IN_NOTICE =
  'Sign in to Codex in Settings › AI to use your ChatGPT plan here — or choose another model.'

/** the notice to show for `route`, or null when it does not apply */
export function codexSignInNotice(
  route: { providerId: string; modelId?: string } | null | undefined,
  providers: ReadonlyArray<{ id: string; status: string }>,
): string | null {
  if (route?.providerId !== 'codex') return null
  const codex = providers.find((provider) => provider.id === 'codex')
  return codex?.status === 'connected' ? null : CODEX_SIGN_IN_NOTICE
}
