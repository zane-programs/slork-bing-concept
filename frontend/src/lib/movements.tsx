/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import type { MovementData, MovementId } from "@shared/movements";

export { MOVEMENT_IDS, MOVEMENT_NAMES } from "@shared/movements";
export type {
  ClientId,
  MovementData,
  MovementId,
  MovementState,
} from "@shared/movements";

export const MOVEMENT_RENDERERS: {
  [K in MovementId]: (data: MovementData[K]) => ReactNode;
} = {
  "movement-1": (data) => (
    <div>
      <h2>Movement 1</h2>
      <p>Phase: {data.phase}</p>
    </div>
  ),
  "movement-2": (data) => (
    <div>
      <h2>Movement 2</h2>
      <p>Note: {data.note || "—"}</p>
    </div>
  ),
};
