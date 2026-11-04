import type { SheetBindings } from "../../entities/character/ui/sheet-port";
import { Dnd5eSheet, MobSheet, UnsupportedSheet } from "../../systems/dnd5e/ui/CharacterSheets";
import { CharacterCatalog, PlayerSheets, MobSheets } from "../../systems/dnd5e/ui/CharacterCatalog";
import type { SystemBindings, HealthControlResolver } from "../../entities/character/ui/health-slot";
import { dnd5eDefinition, mobDefinition } from "../../systems/dnd5e/model/definitions";
import { HpControls } from "../../systems/dnd5e/ui/HpControls";
import { resolveDefinition, systemPresentation } from "./registry";

// UI types stay outside the pure registry. Component identities are module-stable.
const healthControls = new Map([[dnd5eDefinition, HpControls], [mobDefinition, HpControls]]);
export const resolveHealthControl: HealthControlResolver = key => {
  const definition = resolveDefinition(key);
  return definition ? healthControls.get(definition) : undefined;
};
const sheetRenderers = new Map([[dnd5eDefinition, Dnd5eSheet], [mobDefinition, MobSheet]]);
export const resolveSheet: SheetBindings["resolve"] = key => {
  const definition = resolveDefinition(key);
  return definition ? sheetRenderers.get(definition) : undefined;
};
export const systemBindings: SystemBindings = {
  presentation: systemPresentation,
  healthControl: resolveHealthControl,
  sheet: { resolve: resolveSheet, unsupported: UnsupportedSheet },
  catalog: { Root: CharacterCatalog, Players: PlayerSheets, Mobs: MobSheets },
};
