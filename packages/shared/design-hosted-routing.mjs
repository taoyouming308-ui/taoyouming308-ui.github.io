/** Public routing constants only. No activation, credentials or authority. */
export const DESIGN_APP1_ORIGIN='https://taoyouming308-ui.github.io';
export const DESIGN_EDGE_ORIGIN='https://pdssrmpeiuwvxzsgschm.supabase.co';
export const DESIGN_EDGE_BASE_PATH='/functions/v1/design-api';
export const isDesignApiBasePath=(origin,path)=>path===''||(origin===DESIGN_EDGE_ORIGIN&&path===DESIGN_EDGE_BASE_PATH);
