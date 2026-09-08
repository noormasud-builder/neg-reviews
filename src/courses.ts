/**
 * Course catalogue, pulled live from the Get Licensed DB on 2026-09-08.
 * Only non-archived / active courses are worth matching against review text —
 * archived ones can't have run in the last fortnight.
 */

export interface Course {
  id: number;
  name: string;
  /** Lowercase strings that, if found in review text, imply this course. */
  aliases: string[];
}

export const COURSES: Course[] = [
  { id: 12, name: 'SIA Door Supervisor Training', aliases: ['door supervisor', 'door supervision', 'doorsupervisor', 'ds course', 'sia ds', 'd s course', 'ds'] },
  { id: 13, name: 'SIA CCTV Operator Training', aliases: ['cctv operator', 'cctv'] },
  { id: 29, name: 'SIA Close Protection Training', aliases: ['close protection', 'bodyguard', 'cp course', 'cpo'] },
  { id: 31, name: 'First AID at Work (FAW) - Level 3', aliases: ['first aid at work', 'faw'] },
  { id: 33, name: 'Personal Licence Training (APLH) Level 2', aliases: ['personal licence', 'personal license', 'aplh'] },
  { id: 44, name: 'SIA Security Guard Training', aliases: ['security guard', 'security guarding', 'sg course', 'sia sg'] },
  { id: 49, name: 'Basic Handcuff Training', aliases: ['basic handcuff', 'handcuff training'] },
  { id: 61, name: 'Emergency First Aid at Work (EFAW)', aliases: ['emergency first aid', 'efaw'] },
  { id: 69, name: 'Close Protection Firearms (Level 4)', aliases: ['close protection firearms', 'cp firearms'] },
  { id: 75, name: 'Paediatric First Aid Level 3', aliases: ['paediatric first aid', 'pediatric first aid'] },
  { id: 91, name: 'Green CSCS Labourer Card Course', aliases: ['green cscs', 'cscs labourer', 'green card'] },
  { id: 109, name: 'Level 1 Certificate in Beauty Therapy', aliases: ['beauty therapy level 1', 'l1 beauty'] },
  { id: 110, name: 'Level 2 Certificate in Beauty Therapy', aliases: ['beauty therapy level 2', 'l2 beauty', 'beauty therapy'] },
  { id: 119, name: 'SIA Top-Up Training for Door Supervisors', aliases: ['top up door supervisor', 'top-up ds', 'ds top up', 'door supervisor top up'] },
  { id: 120, name: 'SIA Top-Up Training for Security Guard', aliases: ['top up security guard', 'top-up sg', 'sg top up'] },
  { id: 122, name: 'SIA Top-Up Training for Close Protection', aliases: ['top up close protection', 'top-up cp', 'cp top up'] },
  { id: 127, name: 'Level 3 Comfort Management', aliases: ['comfort management'] },
  { id: 128, name: 'Level 3 Education Training', aliases: ['education training', 'aet', 'level 3 aet'] },
  { id: 129, name: 'Emergency Care For First Aid Responders', aliases: ['emergency care for first aid responders', 'ecfr'] },
  { id: 130, name: 'Safeguarding of Children and Adults Level 3 (VTQ)', aliases: ['safeguarding'] },
  { id: 131, name: 'Mental Health in the Workplace Level 2 (VTQ)', aliases: ['mental health in the workplace', 'mental health awareness'] },
  { id: 132, name: 'Health and Safety in the Workplace Level 2 (VTQ)', aliases: ['health and safety in the workplace'] },
  { id: 137, name: 'EUSR SHEA Gas', aliases: ['shea gas', 'eusr gas'] },
  { id: 139, name: 'Health and Safety in a Construction Environment (Level 1) - CSCS Labourer Card', aliases: ['construction environment', 'cscs card', 'cscs'] },
  { id: 144, name: 'Security Screening BS7858', aliases: ['bs7858', 'security screening'] },
  { id: 145, name: 'Use of Mechanical Restraints (Handcuffs) - L3 Award', aliases: ['mechanical restraints', 'handcuffs level 3', 'handcuffs l3'] },
  { id: 146, name: 'L2 Award for Cash And Valuables In Transit (CViT)', aliases: ['cash and valuables', 'cvit'] },
  { id: 147, name: 'SIA Security Train the Trainer Masterclass', aliases: ['train the trainer', 'ttt masterclass'] },
  { id: 148, name: 'Security Drone Pilot', aliases: ['drone pilot', 'security drone'] },
  { id: 149, name: 'SIA Top-Up Refresher Training for Door Supervisor', aliases: ['refresher door supervisor', 'ds refresher', 'door supervisor refresher', 'top up refresher ds'] },
  { id: 150, name: 'SIA Top-Up Refresher Training for Security Guard', aliases: ['refresher security guard', 'sg refresher', 'security guard refresher'] },
  { id: 152, name: 'SIA Top-Up Refresher Training for Close Protection', aliases: ['refresher close protection', 'cp refresher', 'close protection refresher'] },
];

const BY_ID = new Map(COURSES.map((c) => [c.id, c]));

export function courseName(id: number | null | undefined): string {
  if (id == null) return 'Unknown course';
  return BY_ID.get(id)?.name ?? `Course #${id}`;
}

/**
 * Bare two-letter abbreviations are only trusted when they stand alone as a
 * word — otherwise "ds" fires on "kids", "cp" on "cpd", and every review that
 * mentions a child matches Door Supervisor.
 */
const STANDALONE_ONLY = new Set(['ds', 'cp', 'sg', 'cctv', 'faw', 'efaw', 'aplh', 'cvit', 'aet', 'ecfr', 'cscs']);

/**
 * Find every course the text plausibly refers to. Returns matches sorted by
 * alias specificity — "ds refresher" (course 149) beats a bare "ds" (12),
 * because the longer alias is the more committed statement.
 */
export function detectCourses(text: string): Array<{ course: Course; matchedAlias: string }> {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hits: Array<{ course: Course; matchedAlias: string }> = [];

  for (const course of COURSES) {
    let best: string | null = null;
    for (const alias of course.aliases) {
      const normalised = alias.replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalised) continue;
      if (STANDALONE_ONLY.has(normalised)) {
        if (!haystack.includes(` ${normalised} `)) continue;
      } else if (!haystack.includes(normalised)) {
        continue;
      }
      if (!best || normalised.length > best.length) best = normalised;
    }
    if (best) hits.push({ course, matchedAlias: best });
  }

  return hits.sort((a, b) => b.matchedAlias.length - a.matchedAlias.length);
}
