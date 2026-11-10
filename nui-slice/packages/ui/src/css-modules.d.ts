/** CSS Modules typing for the ui package (spec: hybrid Tailwind + CSS Modules). */
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
