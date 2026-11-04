import type { ComponentType, ReactNode } from "react";
import type { UserInfo, Character } from "../../../shared/api/protocol";

export interface CatalogRowProps {
  character: Character;
  avatar?: ReactNode;
  children?: ReactNode;
  extra?: ReactNode;
  deletionImpact?: string;
}
export type RenderCatalogRow = (props: CatalogRowProps) => ReactNode;
export interface CatalogRootProps {
  characters: Record<string, Character>;
  isGm: boolean;
  renderPlayers: (list: Character[]) => ReactNode;
  renderMobs: (list: Character[]) => ReactNode;
}
export interface PlayerCatalogProps {
  list: Character[];
  accounts: UserInfo[];
  isGm: boolean;
  renderRow: RenderCatalogRow;
  onCreate: () => void;
  onImport: (file: File) => Promise<void>;
  onPlace: (character: Character) => void;
}
export interface MobCatalogProps {
  list: Character[];
  placeHidden: boolean;
  renderRow: RenderCatalogRow;
  onCreate: () => void;
  onCopy: (character: Character) => void;
  onPlace: (character: Character) => void;
  onPlaceHidden: (hidden: boolean) => void;
}
export interface CatalogBindings {
  Root: ComponentType<CatalogRootProps>;
  Players: ComponentType<PlayerCatalogProps>;
  Mobs: ComponentType<MobCatalogProps>;
}
