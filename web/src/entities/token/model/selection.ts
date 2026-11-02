import type { Token } from "../../../shared/api/protocol";

/** Что нужно карточки токена. Без координат: они меняются на каждом кадре драга. */
export type SelectedToken = Pick<
  Token,
  "id" | "name" | "color" | "owner_id" | "size" | "character_id" | "image_url" | "layer" | "hp"
>;
