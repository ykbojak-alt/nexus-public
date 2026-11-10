// A small title bar for a detachable terminal window: shows the terminal's
// address and a Dock back button that returns the terminal to its pane and
// closes the window. Opened by the pane header's undock button:
//   openOverlay({ kind: "window", key, width, height, layout: {
//     type: "column", children: [
//       { type: "block", size: { px: 30 }, content: { mod: "pane-undock-bar" } },
//       { type: "block", content: { terminal: "<address>" } },
//     ] } })
// The current terminal is remembered in shared("pane.undock") by the opener,
// so the button below always acts on the terminal right here.
// Presses here never drag the window (stop_propagation); the block's empty
// space does, so the window still moves by its title bar.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, shared, theme, terminals } from "nx";

export default class PaneUndockBar extends View {
  init() {
    this.u = shared("pane.undock") ?? {};
  }

  dockBack() {
    const p = props();
    const u = this.u;
    if (!u.terminal) return;
    run("terminal.keep", { terminal: u.terminal, place: "right" });
    closeOverlay(p?.overlay);
  }

  render(cx) {
    const t = theme();
    const u = this.u;
    const addr = u.terminal ?? "";
    const term = addr ? terminals().find((x) => x.address === addr) : null;
    const label = term?.name || addr || "terminal";
    return h_flex()
      .id("pane-undock-bar")
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .child(div().flex_none().font_medium().text_color(t.foreground).child(label))
      .child(div().flex_1().truncate().text_color(t.dim).child(addr))
      .child(
        div()
          .id("undock-dock")
          .p(3)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Dock back into the pane")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.dockBack();
          })
          .child(svg("mods/pane/dock.svg").size(14)),
      );
  }
}
