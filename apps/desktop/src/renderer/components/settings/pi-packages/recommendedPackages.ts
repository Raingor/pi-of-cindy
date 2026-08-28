export interface RecommendedPackage {
  id: string;
  name: string;
  descKey: string;
}

export const RECOMMENDED_PACKAGES: RecommendedPackage[] = [
  { id: 'npm:pi-hermes-memory', name: 'pi-hermes-memory', descKey: 'settings.piPackages.recommended.hermesMemory' },
  { id: 'npm:context-mode', name: 'context-mode', descKey: 'settings.piPackages.recommended.contextMode' },
  { id: 'npm:pi-subagents', name: 'pi-subagents', descKey: 'settings.piPackages.recommended.subagents' },
  { id: 'npm:pi-web-access', name: 'pi-web-access', descKey: 'settings.piPackages.recommended.webAccess' },
  { id: 'npm:pi-smart-fetch', name: 'pi-smart-fetch', descKey: 'settings.piPackages.recommended.smartFetch' },
  { id: 'npm:pi-rtk-optimizer', name: 'pi-rtk-optimizer', descKey: 'settings.piPackages.recommended.rtkOptimizer' },
  { id: 'npm:pi-puppeteer', name: 'pi-puppeteer', descKey: 'settings.piPackages.recommended.puppeteer' },
  { id: 'npm:pi-intercom', name: 'pi-intercom', descKey: 'settings.piPackages.recommended.intercom' },
  { id: 'npm:pi-prompt-template-model', name: 'pi-prompt-template-model', descKey: 'settings.piPackages.recommended.promptTemplate' },
  { id: 'npm:@pi-unipi/notify', name: '@pi-unipi/notify', descKey: 'settings.piPackages.recommended.notify' },
];
