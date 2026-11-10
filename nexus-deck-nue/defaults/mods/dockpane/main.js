// DockPane — the pane a docked external window lives in.
//
// The real pixels belong to the embedded HWND: the core owns a host-anchor
// window positioned over this panel's rect minus the pane-frame header strip
// (window.rs sync_docks insets it), so the app-drawn header — close button
// included — stays reachable. This mod only fills the space with a quiet
// placeholder for the moment before the embed is up (or after it fails).
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, props } from "nx";

const hex = (n) => "0x" + Number(n).toString(16).toUpperCase();

export default class DockPane extends View {
  render() {
    const t = theme();
    const p = props() ?? {};
    const title = p.title || "window";
    const sub = [p.pid ? `pid ${p.pid}` : "", p.hwnd != null ? hex(p.hwnd) : ""].filter(Boolean).join("  ·  ");
    return v_flex().size_full().bg(t.surface).items_center().justify_center().gap(6)
      .child(div().text_size(13).text_color(t.dim).child(title))
      .child(div().text_size(11).text_color(t.dim).opacity(0.7).child(sub || "embedded window"));
  }
}
