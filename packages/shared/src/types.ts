export type Role = 'admin' | 'musician' | 'member';

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export interface AuthResult {
  token: string;
  user: User;
}

/** One row of `GET /sync`. Tombstones have `deletedAt` set. */
export interface SyncSong {
  id: string;
  number: number | null;
  title: string;
  key: string | null;
  bpm: number | null;
  timeSig: string | null;
  rhythm: string | null;
  chordpro: string;
  version: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SyncPage {
  songs: SyncSong[];
  /** `<updated_at>:<id>` of the last row; pass back as `?cursor=`. */
  cursor: string;
  hasMore: boolean;
}

export type ProposalKind = 'edit' | 'new';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  songId: string | null;
  baseVersion: number | null;
  chordpro: string;
  title: string;
  status: ProposalStatus;
  reviewComment: string | null;
  createdAt: number;
  reviewedAt: number | null;
  author: { id: string; email: string; name: string | null };
  /** Current server song for edit proposals (admin queue only). */
  current: { chordpro: string; version: number } | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

/** An album shared by musicians; `songIds` is the set-list order. */
export interface SharedAlbum {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
  updatedAt: number;
}
