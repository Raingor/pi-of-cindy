import os from 'node:os';
import path from 'node:path';

import type {
  ListCustomizationsOptions,
  ListCustomizationsResult,
} from '../../types/customizations.js';
import { scanCustomizationSources, type SourceDef } from '../shared/customization-scanner.js';

function buildPiSources(workingDirs: string[]): SourceDef[] {
  const home = os.homedir();
  const sources: SourceDef[] = [
    { engine: 'pi', kind: 'skill', scope: 'user', dir: path.join(home, '.agents', 'skills') },
    { engine: 'pi', kind: 'skill', scope: 'user', dir: path.join(home, '.pi', 'agent', 'skills') },
  ];
  for (const wd of workingDirs) {
    if (!wd || !path.isAbsolute(wd)) continue;
    sources.push(
      { engine: 'pi', kind: 'skill', scope: 'repo', dir: path.join(wd, '.agents', 'skills'), workingDir: wd },
      { engine: 'pi', kind: 'skill', scope: 'repo', dir: path.join(wd, '.pi', 'agent', 'skills'), workingDir: wd },
    );
  }
  return sources;
}

export async function scanPiCustomizations(
  opts: ListCustomizationsOptions,
): Promise<ListCustomizationsResult> {
  if (opts.kinds && opts.kinds.length > 0 && !opts.kinds.includes('skill')) {
    return { items: [], errors: [] };
  }

  const workingDirs = opts.workingDirs ?? [];
  const sources = buildPiSources(workingDirs);
  const result = scanCustomizationSources(sources, null);

  result.items.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.name.localeCompare(b.name);
  });

  return result;
}
