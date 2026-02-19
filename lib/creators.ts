export interface CreatorConfig {
  id: string;
  igUserId: string | null;
  username: string;
  displayName: string;
  isOwned: boolean;
}

export const CREATORS: CreatorConfig[] = [
  {
    id: "nicki_entenmann",
    igUserId: "17841401475580469",
    username: "nicki.entenmann",
    displayName: "Nicki Entenmann",
    isOwned: true,
  },
  // Add non-owned creators here as needed:
  // {
  //   id: "creator_handle",
  //   igUserId: null,
  //   username: "creator_handle",
  //   displayName: "Creator Name",
  //   isOwned: false,
  // },
];
