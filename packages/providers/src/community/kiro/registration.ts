import { isRegisteredProvider, registerProvider } from '../../registry';
import { KIRO_CAPABILITIES } from './capabilities';
import { KiroProvider } from './provider';

/**
 * Register the Kiro community provider.
 */
export function registerKiroProvider(): void {
  if (isRegisteredProvider('kiro')) return;
  registerProvider({
    id: 'kiro',
    displayName: 'Kiro (community)',
    factory: () => new KiroProvider(),
    capabilities: KIRO_CAPABILITIES,
    builtIn: false,
    credentials: {
      kind: 'static',
      specs: [
        {
          vendor: 'kiro',
          displayName: 'Kiro',
          kinds: ['api_key'],
        },
      ],
    },
  });
}
