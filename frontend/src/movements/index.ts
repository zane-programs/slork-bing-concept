import type { MovementData, MovementId } from "@shared/types";

import Clicking from "./clicking";
import Counting from "./counting";
import Turn from "./turn";
import Wake from "./wake";

export const MOVEMENT_COMPONENTS: {
  [K in MovementId]: React.FC<{ data: MovementData[K] }>;
} = {
  clicking: Clicking,
  counting: Counting,
  turn: Turn,
  wake: Wake,
};

export { MOVEMENT_IDS, MOVEMENT_NAMES } from "@shared/movements";
export type {
  ClientId,
  MovementData,
  MovementId,
  MovementState,
} from "@shared/types";
