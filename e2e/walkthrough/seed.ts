import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { Api, BISQUE_STEP, PASSWORD, type Account } from '../support/api';
import { eanFor } from '../support/barcodes';
import { FRONTEND } from '../support/paths';
import { grantSiteAdmin } from '../support/site-admin';
import { testTile } from '../support/tiles';
import type { StepInput } from '../../src/lib/generated/types.gen';

type Colour = [number, number, number];

/** The people of the seeded library; every account has the suite password and an address `<first>@example.test`. */
export const PEOPLE = {
  me: { first: 'Ines', name: 'Ines Okafor' },
  mara: { first: 'Mara', name: 'Mara Lindqvist' },
  tomas: { first: 'Tomas', name: 'Tomás Ribeiro' },
  yuki: { first: 'Yuki', name: 'Yuki Tanaka' },
  priya: { first: 'Priya', name: 'Priya Nair' },
  jonas: { first: 'Jonas', name: 'Jonas Becker' },
  lucia: { first: 'Lucia', name: 'Lucía Fernández' },
  admin: { first: 'Admin', name: 'Site Admin' },
  spam: { first: 'Spam', name: 'Sam Spammer' },
  troll: { first: 'Troll', name: 'Rex Troll' },
} as const;
export type PersonKey = keyof typeof PEOPLE;

export const accountOf = (key: PersonKey): Account => ({
  email: `${PEOPLE[key].first.toLowerCase()}@example.test`,
  displayName: PEOPLE[key].name,
  password: PASSWORD,
});

export interface Seeded {
  ids: Record<PersonKey, string>;
  /** Glazes by "Maker CODE". */
  glazes: Record<string, string>;
  /** Combinations by title. */
  combinations: Record<string, string>;
  clubs: { riverside: string; saturday: string; chemists: string };
  /** An invite token of a club the main account is not in, and a buddy link of a person it is not a buddy of. */
  chemistsInvite: string;
  luciaBuddyToken: string;
  /** A glaze with a barcode, which the fake camera can film. */
  barcode: { glaze: string; code: string };
  /** A glaze with a barcode nobody has on the shelf yet. */
  freshBarcode: { glaze: string; code: string };
  hero: { glaze: string; combination: string };
}

interface GlazeSpec {
  maker: string;
  code: string;
  name: string;
  colour: Colour;
  notes: string;
}

const MAKERS: Record<string, string> = {
  Botz: 'BOTZ',
  Amaco: 'AMACO',
  Mayco: 'MAYCO',
  Coyote: 'COYOTE',
  Spectrum: 'SPECTRUM',
  Duncan: 'DUNCAN',
  Laguna: 'LAGUNA',
};

const g = (maker: string, code: string, name: string, colour: Colour, notes: string): GlazeSpec => ({ maker, code, name, colour, notes });

export const GLAZES: GlazeSpec[] = [
  g('Botz', 'CE-1', 'Celadon', [168, 196, 168], 'Cone 6, glossy and translucent; pools pale green in carved lines.'),
  g('Botz', 'TM-3', 'Tenmoku', [52, 36, 28], 'Iron-rich black-brown that breaks rusty on edges.'),
  g('Botz', 'SH-2', 'Shino White', [226, 220, 204], 'Creamy satin; shows carbon trapping when thick.'),
  g('Botz', 'OR-5', 'Oribe Green', [70, 128, 84], 'Copper green, runs a little at cone 6.'),
  g('Botz', 'RD-8', 'Iron Red', [150, 58, 38], 'Needs a thick coat; goes brown when thin.'),
  g('Botz', 'BL-4', 'Cobalt Wash', [44, 70, 150], 'Strong blue; use sparingly or it turns black.'),
  g('Amaco', 'PC-20', 'Blue Rutile', [70, 112, 160], 'Variegated blue, breaks to tan on texture.'),
  g('Amaco', 'PC-25', 'Oatmeal', [214, 196, 160], 'Soft speckled cream, a good base coat.'),
  g('Amaco', 'PC-33', 'Seaweed', [66, 98, 70], 'Deep green with brown breaks.'),
  g('Amaco', 'PC-41', 'Ember', [176, 92, 48], 'Warm orange-brown, nice over white.'),
  g('Amaco', 'PC-52', 'Smoke', [118, 120, 126], 'Cool grey with a satin feel.'),
  g('Amaco', 'PC-61', 'Sage', [152, 170, 128], 'Muted green, very forgiving.'),
  g('Mayco', 'SW-119', 'Blue Surf', [92, 168, 196], 'Bright sea blue, best in three coats.'),
  g('Mayco', 'SW-102', 'Honey Flux', [206, 142, 56], 'Warm amber that flows over darker glazes.'),
  g('Mayco', 'SW-130', 'Plum Crazy', [110, 54, 96], 'Deep purple; shows brush marks.'),
  g('Mayco', 'SW-144', 'Sea Salt', [200, 214, 214], 'Pale blue-white, breaks beautifully.'),
  g('Mayco', 'SW-151', 'Sunflower', [226, 186, 56], 'Clear yellow; keep away from the kiln shelf.'),
  g('Mayco', 'SW-160', 'Cinnamon Stick', [138, 80, 52], 'Rich brown with darker speckles.'),
  g('Coyote', 'CY-01', 'Shino Orange', [214, 150, 96], 'Carbon trap shino; fire in reduction.'),
  g('Coyote', 'CY-07', 'Ash Grey', [160, 160, 150], 'Soft ash look, matte.'),
  g('Coyote', 'CY-12', 'Copper Green', [58, 140, 120], 'Turquoise where thick, green where thin.'),
  g('Coyote', 'CY-18', 'Night Sky', [30, 34, 60], 'Near black with blue flecks.'),
  g('Coyote', 'CY-23', 'Bone', [236, 230, 214], 'Warm white satin matte.'),
  g('Coyote', 'CY-29', 'Rust Dust', [160, 90, 60], 'Dry iron texture.'),
  g('Spectrum', 'SP-500', 'Clear Gloss', [236, 238, 232], 'Food-safe clear, good over underglaze.'),
  g('Spectrum', 'SP-520', 'Lagoon', [60, 150, 170], 'Teal, deepens with a second coat.'),
  g('Spectrum', 'SP-533', 'Mulberry', [124, 60, 90], 'Wine red with purple pools.'),
  g('Spectrum', 'SP-540', 'Pistachio', [180, 200, 120], 'Light green, semi-opaque.'),
  g('Spectrum', 'SP-552', 'Charcoal', [64, 66, 70], 'Dense dark grey.'),
  g('Spectrum', 'SP-560', 'Butter', [236, 212, 150], 'Soft yellow cream.'),
  g('Duncan', 'DN-301', 'Matte Black', [34, 34, 36], 'Flat black; very opaque.'),
  g('Duncan', 'DN-312', 'Dusty Rose', [196, 144, 140], 'Pink with a slight break.'),
  g('Duncan', 'DN-320', 'Deep Teal', [30, 96, 104], 'Dark glossy teal.'),
  g('Duncan', 'DN-333', 'Lemon Zest', [232, 220, 90], 'Bright yellow, glossy.'),
  g('Duncan', 'DN-340', 'Lavender Mist', [168, 150, 196], 'Pale purple, runs slightly.'),
  g('Duncan', 'DN-351', 'Terracotta', [182, 100, 66], 'Earthy red-orange.'),
  g('Laguna', 'LG-10', 'Dolomite Matte', [224, 222, 212], 'Buttery matte, forgiving.'),
  g('Laguna', 'LG-14', 'Chun Blue', [130, 160, 200], 'Milky blue with purple breaks.'),
  g('Laguna', 'LG-17', 'Temmoku Gold', [140, 100, 40], 'Gold-brown crystalline look.'),
  g('Laguna', 'LG-21', 'Moss', [112, 130, 70], 'Mossy green, breaks yellow.'),
  g('Laguna', 'LG-26', 'Slate', [96, 108, 118], 'Blue-grey satin.'),
  g('Laguna', 'LG-30', 'Peach Bloom', [220, 160, 140], 'Soft pink-copper reduction look.'),
  g('Laguna', 'LG-35', 'Walnut', [100, 70, 50], 'Dark brown glossy.'),
  g('Laguna', 'LG-40', 'Opal', [208, 220, 224], 'Cool white, satin.'),
];

export const glazeKey = (spec: GlazeSpec) => `${spec.maker} ${spec.code}`;
/** The glazes that are on the main account's shelf, so "I can make now" has results. */
const SHELF_CORE = 20;

const TAGS = ['cone-6', 'tile', 'mug', 'bowl', 'layering', 'satin', 'glossy', 'food-safe', 'reduction', 'speckled', 'blue', 'green'];
const METHODS = ['Dip', 'Brush', 'Pour', 'Spray'];

/** A repeatable pseudo-random generator, so every seeding builds the same library. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

const fixture = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: readFileSync(join(FRONTEND, 'e2e', 'fixtures', name)) });

export async function seedLibrary(request: (label: string) => Promise<APIRequestContext>): Promise<Seeded> {
  const apis = {} as Record<PersonKey, Api>;
  const ids = {} as Record<PersonKey, string>;
  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    apis[key] = new Api(await request(key));
    const account = accountOf(key);
    await apis[key].signUp(account);
    ids[key] = (await apis[key].me()).id;
  }
  const { me, mara, tomas, yuki, priya, jonas, lucia, admin, spam } = apis;
  const avatarColours: Record<PersonKey, [Colour, Colour]> = {
    me: [
      [214, 120, 80],
      [120, 52, 40],
    ],
    mara: [
      [96, 168, 150],
      [30, 84, 96],
    ],
    tomas: [
      [220, 180, 90],
      [140, 80, 40],
    ],
    yuki: [
      [180, 150, 200],
      [80, 60, 130],
    ],
    priya: [
      [230, 140, 150],
      [150, 60, 90],
    ],
    jonas: [
      [130, 160, 210],
      [40, 70, 130],
    ],
    lucia: [
      [170, 200, 120],
      [70, 110, 60],
    ],
    admin: [
      [160, 160, 160],
      [60, 60, 70],
    ],
    spam: [
      [250, 80, 80],
      [120, 20, 20],
    ],
    troll: [
      [90, 90, 90],
      [30, 30, 30],
    ],
  };
  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    const [top, bottom] = avatarColours[key];
    await apis[key].uploadAvatar(testTile(`${key}.png`, top, bottom, 0.01, key.length + 3));
  }

  // Glazes, created by the potters in turn.
  const authors = [mara, tomas, yuki, priya, jonas, lucia];
  const glazeIds: Record<string, string> = {};
  const manufacturerIds: Record<string, string> = {};
  const rand = random(7);
  for (const [index, spec] of GLAZES.entries()) {
    const author = authors[index % authors.length];
    const manufacturerId = manufacturerIds[spec.maker];
    const created = await author.addGlaze({
      ...(manufacturerId ? { manufacturerId } : { newManufacturer: { name: spec.maker, shortId: MAKERS[spec.maker] } }),
      code: spec.code,
      name: spec.name,
      notes: spec.notes,
      tags: rand() < 0.5 ? ['cone-6', rand() < 0.5 ? 'glossy' : 'satin'] : ['cone-6'],
    });
    manufacturerIds[spec.maker] ??= created.glaze.manufacturer.id;
    glazeIds[glazeKey(spec)] = created.id;
  }
  const glazeOf = (index: number) => glazeIds[glazeKey(GLAZES[index])];

  // Combinations: pairs and trios of glazes. The first ones only use the main account's shelf glazes.
  const colourOf = (index: number) => GLAZES[index].colour;
  const people: Array<{ key: PersonKey; api: Api }> = [
    { key: 'mara', api: mara },
    { key: 'tomas', api: tomas },
    { key: 'yuki', api: yuki },
    { key: 'priya', api: priya },
    { key: 'jonas', api: jonas },
    { key: 'lucia', api: lucia },
    { key: 'me', api: me },
  ];
  const combinations: Record<string, string> = {};
  const seen = new Set<string>();
  const finishedPhotos = ['mug-photo.jpg', 'mug-photo-2.jpg', 'jug-photo.jpg'];
  const heroTitle = 'Celadon over Shino White';
  let count = 0;
  const make = async (author: { key: PersonKey; api: Api }, picks: number[], options: { photo: boolean; title?: string; cone?: string; basedOn?: string }) => {
    const names = picks.map((index) => GLAZES[index].name);
    const title = options.title ?? (names.length === 2 ? `${names[1]} over ${names[0]}` : `${names[0]}, ${names[1]} and ${names[2]}`);
    if (seen.has(title)) return undefined;
    seen.add(title);
    const steps: StepInput[] = picks.map((index) => ({
      type: 'GLAZE',
      glazeId: glazeOf(index),
      coats: 1 + Math.floor(rand() * 3),
      method: METHODS[Math.floor(rand() * METHODS.length)],
    }));
    if (rand() < 0.3) steps.unshift(BISQUE_STEP);
    const cone = options.cone ?? (rand() < 0.75 ? '6' : rand() < 0.5 ? '5' : '04');
    const tags = ['cone-6', TAGS[2 + Math.floor(rand() * 10)]].filter((tag, at, all) => all.indexOf(tag) === at);
    const id = await author.api.addCombination({
      title,
      description: `${names.join(' with ')}: ${cone === '04' ? 'low fire test' : 'dipped and fired in an electric kiln'}, ${rand() < 0.5 ? 'slow cooled' : 'normal cycle'}.`,
      cone,
      atmosphere: 'OXIDATION',
      clayBody: rand() < 0.5 ? 'Speckled stoneware' : 'Smooth white stoneware',
      kiln: 'Skutt KM-1027',
      tags,
      steps,
      basedOnId: options.basedOn ?? null,
    });
    combinations[title] = id;
    if (options.photo) {
      const top = colourOf(picks[picks.length - 1]);
      const bottom = colourOf(picks[0]);
      await author.api.uploadToCombination(id, {
        file: testTile(`tile-${count}.png`, top, bottom, 0.012, count + 2),
        firedOn: '2026-09-' + String(1 + (count % 27)).padStart(2, '0'),
      });
      if (count % 5 === 0) {
        await author.api.uploadToCombination(id, {
          kind: 'FINISHED',
          file: fixture(finishedPhotos[count % 3]),
          caption: 'Finished mug, second firing',
        });
      }
    }
    count++;
    return id;
  };

  // The hero combination first, with a gallery of three photos.
  const heroPicks = [GLAZES.findIndex((spec) => spec.name === 'Shino White'), GLAZES.findIndex((spec) => spec.name === 'Celadon')];
  const heroId = (await make(people[0], heroPicks, { photo: true, title: heroTitle, cone: '6' }))!;
  await mara.uploadToCombination(heroId, { kind: 'FINISHED', file: fixture('jug-photo.jpg'), caption: 'Jug with a carved band', firedOn: '2026-10-02' });
  await mara.uploadToCombination(heroId, {
    kind: 'TEST_TILE',
    file: testTile('hero-2.png', [190, 214, 180], [236, 232, 218], 0.02, 41),
    caption: 'Thinner coat of celadon',
  });
  // A variation by the main account and one by a buddy.
  await make(people[6], heroPicks, { photo: true, title: 'Celadon over Shino White, extra coat', cone: '6', basedOn: heroId });
  const variationId = combinations['Celadon over Shino White, extra coat'];
  await make(people[1], heroPicks, { photo: true, title: 'Celadon over Shino White, brushed', cone: '5', basedOn: variationId });

  const total = 64;
  while (Object.keys(combinations).length < total) {
    const index = Object.keys(combinations).length;
    const author = people[index % people.length];
    const own = author.key === 'me';
    // The first third use shelf-core glazes only, so "I can make now" lists them.
    const pool = index % 3 === 0 || own ? SHELF_CORE : GLAZES.length;
    const trio = rand() < 0.25;
    const picks = Array.from({ length: trio ? 3 : 2 }, () => Math.floor(rand() * pool));
    if (new Set(picks).size !== picks.length) continue;
    // Four of the main account's own combinations wait for a photo.
    await make(author, picks, { photo: !(own && index % 4 === 0) });
  }

  // Glaze photos (a packaging picture and a test tile) on some glazes, tags and a corrected glaze for its history.
  for (const index of [0, 6, 12, 13, 18, 24, 31]) {
    await mara.uploadToGlaze(glazeOf(index), {
      kind: 'PACKAGING',
      file: testTile(`pack-${index}.png`, [240, 240, 236], colourOf(index), 0.004, index),
      caption: 'Jar label',
    });
    await tomas.uploadToGlaze(glazeOf(index), {
      kind: 'TEST_TILE',
      file: testTile(`glaze-${index}.png`, colourOf(index), [colourOf(index)[0] * 0.6, colourOf(index)[1] * 0.6, colourOf(index)[2] * 0.6], 0.015, index + 9),
    });
  }
  const hero = glazeOf(heroPicks[1]);
  await yuki.correctGlaze(hero, { notes: 'Cone 6, glossy and translucent; pools pale green in carved lines. Thin coats stay almost clear.' });
  await jonas.correctGlaze(hero, { name: 'Celadon Green' });
  await jonas.correctGlaze(hero, { name: 'Celadon' });
  const barcode = eanFor('hero-celadon');
  await mara
    .addGlaze({ manufacturerId: manufacturerIds.Botz, code: 'CE-2', name: 'Celadon Light', barcode, notes: 'Lighter celadon with a clear break.' })
    .then((created) => {
      glazeIds['Botz CE-2'] = created.id;
    });
  await mara.addTags('glazes', hero, ['translucent']);
  await mara.addTags('glazes', glazeIds['Botz CE-2'], ['translucent']);
  await mara.uploadToGlaze(glazeIds['Botz CE-2'], { kind: 'TEST_TILE', file: testTile('ce2.png', [196, 220, 190], [160, 196, 170], 0.01, 77) });
  // A glaze with a barcode that nobody keeps on the shelf yet, for the camera of the phone.
  const freshBarcode = eanFor('fresh-sage');
  await tomas
    .addGlaze({ manufacturerId: manufacturerIds.Amaco, code: 'PC-70', name: 'Evergreen', barcode: freshBarcode, notes: 'Dark forest green.' })
    .then((created) => {
      glazeIds['Amaco PC-70'] = created.id;
    });

  // Clubs: Riverside (the main account is its admin), Saturday Studio (Jonas) and the Chemists (the main account is not in it).
  const riverside = await me.clubWithInvite('Riverside Clay Club');
  await me.updateClub(riverside.club.id, {
    name: 'Riverside Clay Club',
    houseRules: 'Label every jar with your name. Wipe the glaze bench after use. Share what you learn.',
    invitesEnabled: true,
  });
  for (const member of [mara, tomas, yuki, priya]) await member.joinClub(riverside.token);
  await me.setClubRole(riverside.club.id, ids.mara, 'ADMIN');
  const saturday = await jonas.clubWithInvite('Saturday Studio');
  for (const member of [me, lucia, priya]) await member.joinClub(saturday.token);
  const chemists = await jonas.clubWithInvite('Glaze Chemists');

  // Buddies: Mara and Tomás are buddies, Yuki asked the main account, the main account asked Priya.
  for (const other of [mara, tomas]) {
    const token = await other.replaceBuddyLink();
    await me.requestBuddyByLink(token);
    await other.acceptBuddy(ids.me);
  }
  await yuki.requestBuddyInClub(riverside.club.id, ids.me);
  await me.requestBuddyInClub(riverside.club.id, ids.priya);
  const luciaBuddyToken = await lucia.replaceBuddyLink();

  // Stock: the main account has the core glazes (a few used up), the club shelves and the buddies' own glazes differ.
  for (let index = 0; index < SHELF_CORE; index++) {
    const used = index % 7 === 6;
    await me.addStock({
      glazeId: glazeOf(index),
      ownerType: 'personal',
      quantityG: used ? 0 : [250, 500, 750, 1000, 150][index % 5],
      jarSizeG: index % 3 === 0 ? 500 : 250,
    });
  }
  await me.addGlaze({ manufacturerId: manufacturerIds.Botz, code: 'WH-9', name: 'Winter White', stock: { quantityG: 500, jarSizeG: 500 } });
  for (const index of [20, 21, 22, 23, 24, 25, 26, 27])
    await me.addStock({ glazeId: glazeOf(index), ownerType: 'club', clubId: riverside.club.id, quantityG: 800 });
  for (const index of [28, 29, 30]) await me.addStock({ glazeId: glazeOf(index), ownerType: 'club', clubId: saturday.club.id, quantityG: 600 });
  for (const index of [20, 30, 31, 32, 33, 34, 35, 36]) await mara.addStock({ glazeId: glazeOf(index), ownerType: 'personal', quantityG: 400 });
  for (const index of [37, 38, 39, 40, 41, 12, 13]) await tomas.addStock({ glazeId: glazeOf(index), ownerType: 'personal', quantityG: 300 });
  const own = await me.stock();
  const secret = own.find((entry) => entry.glazeId === glazeOf(3));
  if (secret) await me.setKeepPrivate(secret.id, true);
  // The hero glaze is on a buddy's shelf but not the main account's; the combination uses it.
  const heroGlaze = glazeOf(heroPicks[1]);
  await mara.addStock({ glazeId: heroGlaze, ownerType: 'personal', quantityG: 500 });

  // Favourites of the main account.
  const titles = Object.keys(combinations);
  for (const title of [heroTitle, ...titles.filter((_, index) => index % 9 === 2).slice(0, 7)]) await me.favourite('combinations', combinations[title]);
  for (const index of [0, 6, 12, 18]) await me.favourite('glazes', glazeOf(index));

  // Photos with a club audience, for the club page.
  await mara.uploadToCombination(combinations[titles[10]], {
    visibility: 'CLUB',
    clubId: riverside.club.id,
    file: testTile('club-photo.png', [200, 150, 120], [80, 50, 40], 0.01, 61),
    caption: 'Riverside test kiln, shelf 2',
  });

  // Site administration: reports, deletions, a ban and error reports.
  await grantSiteAdmin(accountOf('admin').email);
  await spam.uploadAvatar(testTile('spam-avatar.png', [250, 80, 80], [120, 20, 20], 0.05, 5));
  const spamAvatar = (await spam.me()).avatarId;
  if (spamAvatar) {
    await mara.reportAvatar(spamAvatar, 'Not a profile picture, looks like an advert.');
    await yuki.reportAvatar(spamAvatar, null);
  }
  const reportedCombination = combinations[titles[20]];
  const spamImage = await spam.uploadToCombination(reportedCombination, {
    file: testTile('spam.png', [250, 80, 80], [120, 20, 20], 0.05, 6),
    caption: 'Buy cheap glaze now',
  });
  await mara.reportImage(spamImage.id, 'Spam advert in a combination photo.');
  await tomas.reportImage(spamImage.id, 'Not a test tile.');
  const other = await priya.uploadToCombination(combinations[titles[22]], {
    file: testTile('oops.png', [120, 120, 120], [60, 60, 60], 0.02, 8),
    caption: 'Blurry',
  });
  await yuki.reportImage(other.id, null);
  for (const [index, owner] of [mara, yuki, tomas].entries()) {
    const deleted = await owner.uploadToCombination(combinations[titles[30 + index]], {
      file: testTile(`del-${index}.png`, [90, 90, 90], [40, 40, 40], 0.02, index),
      caption: 'Wrong piece',
    });
    await owner.removeImage(deleted.id);
  }
  const adminSession = admin;
  await adminSession.ban(ids.troll, 'Posted adverts in photos and a profile picture.', true);
  const reporters: Array<[Api, string]> = [
    [mara, 'TypeError: Cannot read properties of undefined (reading "stock")'],
    [tomas, 'TypeError: Cannot read properties of undefined (reading "stock")'],
    [priya, 'NetworkError when attempting to fetch resource.'],
    [lucia, 'ResizeObserver loop completed with undelivered notifications.'],
  ];
  for (const [index, [reporter, message]] of reporters.entries()) {
    await reporter.setDiagnostics(true);
    await reporter.sendReports([
      { message, stack: `at render (glaze-page.js:${100 + index}:12)\n    at update (runtime.js:88:4)`, count: 1 + index, route: 'glaze' },
      { kind: 'WARNING', message: 'Image decode took 2400 ms', route: 'discover' },
    ]);
  }
  return {
    ids,
    glazes: glazeIds,
    combinations,
    clubs: { riverside: riverside.club.id, saturday: saturday.club.id, chemists: chemists.club.id },
    chemistsInvite: chemists.token,
    luciaBuddyToken,
    barcode: { glaze: glazeIds['Botz CE-2'], code: barcode },
    freshBarcode: { glaze: glazeIds['Amaco PC-70'], code: freshBarcode },
    hero: { glaze: heroGlaze, combination: heroId },
  };
}
