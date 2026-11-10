// DockPicker — pick an external window to dock into a pane.
//
// The app feeds live candidates: `terminal.dock` without hwnd runs
// dock.discover core-side and opens this overlay with props.candidates
// ([{hwnd,title,pid,class,minimized}]). A row click runs
// `terminal.dock {hwnd}`; the core does every guard and the embed.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, run, closeOverlay } from "nx";

const hex = (n) => "0x" + Number(n).toString(16).toUpperCase();

export default class DockPicker extends View {
  pick(c) {
    if (c.minimized) return;
    const p = props() ?? {};
    run("terminal.dock", { hwnd: c.hwnd });
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const cands = Array.isArray(p.candidates) ? p.candidates : [];
    const row = (c, i) => {
      const off = !!c.minimized;
      return h_flex().id(`dock-${i}`).h(44).px(12).items_center().gap(10)
        .border_b(1).border_color(t.border)
        .opacity(off ? 0.45 : 1).cursor_pointer()
        .hover(s => off ? s : s.bg(t.raised))
        .on_click(() => this.pick(c))
        .child(
          v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_size(13).text_color(t.foreground).truncate().child(c.title || "(untitled)"))
            .child(div().text_size(11).text_color(t.dim).child(`${c.pid ? `pid ${c.pid}` : ""}${c.class ? `  ·  ${c.class}` : ""}`)),
        )
        .child(div().flex_none().text_size(11).text_color(off ? t.dim : t.ansi2).child(off ? "свёрнуто" : hex(c.hwnd)));
    };
    return v_flex().id("dockpicker").size_full().bg(t.popover).text_color(t.foreground)
      .child(
        h_flex().h(40).px(14).items_center().border_b(1).border_color(t.border)
          .child(div().text_size(13).font_medium().child("Attach window"))
.child(div().text_size(13).text_color(t.accent).child("LIVE CANDIDATES"))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child(`${cands.length} кандидатов`)),
      )
      .child(
        cands.length
          ? v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(cands.map(row))
          : v_flex().flex_1().items_center().justify_center()
              .child(div().text_size(12).text_color(t.dim).child("нет окон для дока — откройте Windows Terminal или консоль")),
      );
  }
}
