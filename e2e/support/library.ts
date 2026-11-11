import type { StepInput } from '../../src/lib/generated/types.gen';
import { BISQUE_STEP, type Account, type Api } from './api';
import { newAccount } from './test';
import { testTile } from './tiles';

type Colour = [number, number, number];

interface Maker {
  name: string;
  shortId: string;
  glazes: Array<{ code: string; name: string; notes?: string }>;
}

const MAKERS: Maker[] = [
  {
    name: 'Botz',
    shortId: 'BOTZ',
    glazes: [
      { code: 'CE-1', name: 'Celadon', notes: 'Cone 6, glossy and translucent; pools pale green in carved lines.' },
      { code: 'TM-3', name: 'Tenmoku', notes: 'Iron-rich black-brown that breaks rusty on edges.' },
      { code: 'SH-2', name: 'Shino White', notes: 'Creamy satin; shows carbon trapping when thick.' },
      { code: 'OR-5', name: 'Oribe Green', notes: 'Copper green, runs a little at cone 6.' },
    ],
  },
  {
    name: 'Amaco',
    shortId: 'AMACO',
    glazes: [
      { code: 'PC-20', name: 'Blue Rutile', notes: 'Variegated blue, breaks to tan on texture.' },
      { code: 'PC-25', name: 'Oatmeal', notes: 'Soft speckled cream, a good base coat.' },
      { code: 'PC-33', name: 'Seaweed', notes: 'Deep green with brown breaks.' },
    ],
  },
  {
    name: 'Mayco',
    shortId: 'MAYCO',
    glazes: [
      { code: 'SW-119', name: 'Blue Surf', notes: 'Bright sea blue, best in three coats.' },
      { code: 'SW-102', name: 'Honey Flux', notes: 'Warm amber that flows over darker glazes.' },
    ],
  },
];

const AUTHORS = [
  { name: 'Mara Lindqvist', first: 'Mara' },
  { name: 'Tomás Ribeiro', first: 'Tomas' },
] as const;

const PALETTE: Record<string, [Colour, Colour]> = {
  'Celadon over Shino White': [
    [168, 196, 168],
    [214, 224, 206],
  ],
  'Tenmoku with Oatmeal rim': [
    [214, 196, 160],
    [52, 36, 28],
  ],
  'Seaweed and Blue Rutile pour': [
    [52, 108, 96],
    [58, 98, 150],
  ],
  'Honey Flux over Tenmoku': [
    [206, 142, 56],
    [70, 40, 24],
  ],
  'Blue Surf waterfall': [
    [92, 168, 196],
    [30, 84, 128],
  ],
};

/**
 * Names in the shared library. A recording shows the plain names; a test run, whose server other tests share, adds the test's
 * `uid` to manufacturers and titles so searches and lookups find this test's data only.
 */
export class Naming {
  constructor(
    readonly uid: string,
    readonly plain: boolean,
  ) {}

  manufacturer(name: string): string {
    return this.plain ? name : `${name} ${this.uid}`;
  }

  title(text: string): string {
    return this.plain ? text : `${text} ${this.uid}`;
  }

  /** The manufacturer's ID: at most ten letters and digits, starting with a letter. */
  shortId(shortId: string, index: number): string {
    return this.plain ? shortId : `${this.uid}${index}`;
  }

  /** A glaze as the pickers name it: its manufacturer and code. */
  glaze(manufacturer: string, code: string): string {
    return `${this.manufacturer(manufacturer)} ${code}`;
  }
}

/** The IDs of what `seedLibrary` made, by the name it has in the library (a glaze: `Naming.glaze`; a combination: `Naming.title`). */
export interface SeededLibrary {
  glazes: Map<string, string>;
  combinations: Map<string, string>;
}

/**
 * Two potters share a library of three manufacturers with nine glazes and five combinations, the first `photos` of them with a
 * test-tile photo (each upload takes the API's encoder for a moment, so a recording asks for all five, a test run for none or a few).
 */
export async function seedLibrary(newApi: () => Promise<Api>, naming: Naming, photos: number): Promise<SeededLibrary> {
  const { uid } = naming;
  const [mara, tomas] = await Promise.all(AUTHORS.map(() => newApi()));
  const accounts: Account[] = AUTHORS.map((author) => ({ ...newAccount(uid, author.first), displayName: author.name }));
  await mara.signUp(accounts[0]);
  await tomas.signUp(accounts[1]);

  const glazes = new Map<string, string>();
  for (const [index, maker] of MAKERS.entries()) {
    let manufacturerId: string | undefined;
    for (const glaze of maker.glazes) {
      const created = await mara.addGlaze({
        ...(manufacturerId
          ? { manufacturerId }
          : { newManufacturer: { name: naming.manufacturer(maker.name), shortId: naming.shortId(maker.shortId, index) } }),
        code: glaze.code,
        name: glaze.name,
        notes: glaze.notes,
      });
      manufacturerId ??= created.glaze.manufacturer.id;
      glazes.set(naming.glaze(maker.name, glaze.code), created.id);
    }
  }
  const step = (maker: string, code: string, coats: number, method: string): StepInput => ({
    type: 'GLAZE',
    glazeId: glazes.get(naming.glaze(maker, code)),
    coats,
    method,
  });

  const recipes: Array<{ author: Api; title: string; description: string; steps: StepInput[]; cone: string; seed: number }> = [
    {
      author: mara,
      title: 'Celadon over Shino White',
      description: 'Shino as a base, celadon dipped over the top. Soft green where the layers meet.',
      steps: [step('Botz', 'SH-2', 2, 'Dip'), step('Botz', 'CE-1', 1, 'Dip')],
      cone: '6',
      seed: 3,
    },
    {
      author: tomas,
      title: 'Tenmoku with Oatmeal rim',
      description: 'Tenmoku on the body, oatmeal brushed on the rim for a warm break.',
      steps: [step('Botz', 'TM-3', 2, 'Dip'), step('Amaco', 'PC-25', 1, 'Brush')],
      cone: '6',
      seed: 5,
    },
    {
      author: mara,
      title: 'Seaweed and Blue Rutile pour',
      description: 'Seaweed poured over the inside, blue rutile on the outside.',
      steps: [step('Amaco', 'PC-33', 2, 'Pour'), step('Amaco', 'PC-20', 2, 'Dip')],
      cone: '6',
      seed: 9,
    },
    {
      author: tomas,
      title: 'Honey Flux over Tenmoku',
      description: 'The amber runs and pools over a dark base.',
      steps: [step('Botz', 'TM-3', 2, 'Dip'), step('Mayco', 'SW-102', 2, 'Pour')],
      cone: '6',
      seed: 11,
    },
    {
      author: mara,
      title: 'Blue Surf waterfall',
      description: 'Three thin coats of blue surf over bisque.',
      steps: [BISQUE_STEP, step('Mayco', 'SW-119', 3, 'Brush')],
      cone: '5',
      seed: 13,
    },
  ];
  const combinations = new Map<string, string>();
  for (const recipe of recipes) {
    const id = await recipe.author.addCombination({
      title: naming.title(recipe.title),
      description: recipe.description,
      cone: recipe.cone,
      steps: recipe.steps,
      tags: ['cone-6', 'tile'],
    });
    combinations.set(naming.title(recipe.title), id);
    if (combinations.size > photos) continue;
    const [top, bottom] = PALETTE[recipe.title];
    await recipe.author.uploadToCombination(id, { file: testTile(`${recipe.seed}.png`, top, bottom, 0.012, recipe.seed) });
  }
  return { glazes, combinations };
}
