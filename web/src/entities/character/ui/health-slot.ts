import type { CatalogBindings } from "./catalog-slot";
import type { ComponentType } from "react";
import type { CharacterPresentation } from "../model/definition";

export interface HealthControlsProps {
  current?: number;
  max?: number;
  onSet: (value: number) => void;
}
export type HealthControlResolver = (key: string) => ComponentType<HealthControlsProps> | undefined;
export interface SystemBindings {
  presentation: CharacterPresentation;
  catalog: CatalogBindings;
  healthControl: HealthControlResolver;
}
