export interface CreatorConfig {
  id: string;
  igUserId: string | null;
  username: string;
  displayName: string;
  isOwned: boolean;
  ltkSlug?: string;
}

export const CREATORS: CreatorConfig[] = [
  {
    id: "nicki_entenmann",
    igUserId: "17841401475580469",
    username: "nicki.entenmann",
    displayName: "Nicki Entenmann",
    isOwned: true,
    ltkSlug: "nicki",
  },
  {
    id: "livefitwithem",
    igUserId: "17841450282995930",
    username: "livefitwithem",
    displayName: "Emily Ogan",
    isOwned: false,
  },
  {
    id: "annbschulte",
    igUserId: "17841400315480688",
    username: "annbschulte",
    displayName: "Ann Schulte",
    isOwned: false,
  },
  {
    id: "ellenludwigfitness",
    igUserId: "17841401671655474",
    username: "ellenludwigfitness",
    displayName: "Ellen Ludwig",
    isOwned: false,
  },
];
