// One row of the main analytics CSV — "Creative Code" is the source-of-truth key,
// matched against R2 filenames (basename, normalized) and Supabase creative_notes.
export type CreativeRow = {
  creative: string;
  spend: string;
  revenue: string;
  deposits: string;
  pdp: string;
  dia: string;
  romi: string;
  text: string;
};
