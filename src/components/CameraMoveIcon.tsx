import type { CameraMove } from "../../lib/shotPresets";

/** Tiny looping CSS animation of a camera move: a frame with a subject that moves the way the camera does. */
export function CameraMoveIcon({ move }: { move: CameraMove }) {
  return (
    <span aria-hidden className="cam-icon" data-move={move.replace(" ", "-")}>
      <span className="cam-subject" />
    </span>
  );
}
