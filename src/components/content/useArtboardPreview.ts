/** Standalone export: artboards are not part of this export, so the slide
 *  never has an artboard preview, siblings or board images to offer. */
export type ArtboardPreview = { kind: "image"; url: string } | { kind: "empty" } | { kind: "unavailable" };
export type BoardImage = { fileId: string; mimeType: string; src: string };
export type ArtboardSibling = { frameId: string; name: string; width: number; height: number };

const NONE = {
  preview: null as ArtboardPreview | null,
  artboards: [] as ArtboardSibling[],
  boardImages: [] as BoardImage[],
  resolveBoardImage: async (_fileId: string): Promise<string | null> => null,
  invalidate: () => {},
};

export function useArtboardPreview(_frameId: string | null, _wantBoardImages: boolean) {
  return NONE;
}
