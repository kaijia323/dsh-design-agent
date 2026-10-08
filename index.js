/**
 * Host half of the design-canvas bundle.
 *
 * T1 status: intentionally empty so the bundle activates without touching any
 * Host service. T2 (src/host/**) fills this in: it registers the design-project
 * service, the agent tools (design_status / design_frame_write /
 * design_canvas_apply) and the system-prompt design conventions section.
 *
 * Keep every registration inside `apply` with `ctx.effect` so unload is clean,
 * and declare optional services in `inject` so the plugin stays inactive in
 * profiles that lack them instead of throwing.
 */

/** Required Host services. Empty until T2 wires the tool/service layer. */
export const inject = [];

/**
 * Activate the Host half.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  void ctx;
}
