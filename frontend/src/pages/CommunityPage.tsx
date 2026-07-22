/**
 * Community — cross-tenant project hub.
 *
 * Browse projects whose owners have explicitly opted into public sharing.
 * Anyone authenticated can view + comment; nobody can edit a project that
 * isn't theirs. The owner controls the public summary and can withdraw
 * sharing at any time from the Dashboard.
 *
 * Routes:
 *   /community            — browse list
 *   /community/:id        — single project + comment thread
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  MessageSquare, Send, ArrowLeft, Search, Globe, RefreshCw,
  AlertTriangle, Clock, Building2, Trash2,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api } from '../lib/api';
import { avatarUrl } from '../utils/avatar';

type Sort = 'recent' | 'oldest' | 'comments';

interface ListedProject {
  id: string;
  name: string;
  share_summary: string;
  climate_zone: string | null;
  standard: string;
  shared_at: string;
  org_id: string;
  org_name: string | null;
  org_type: string | null;
  comment_count: number;
}

interface Comment {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  author_user_id: string;
  author_org_id: string;
  author_first_name: string | null;
  author_last_name: string | null;
  // Optional so the frontend tolerates an older worker that predates the
  // avatar column (Pages deploys on merge; the worker deploys separately).
  author_avatar_key?: string | null;
  author_org_name: string | null;
}

interface ProjectDetail {
  project: Omit<ListedProject, 'comment_count'>;
  comments: Comment[];
}

export default function CommunityPage() {
  const { id } = useParams();
  if (id) return <CommunityProjectDetail id={id} />;
  return <CommunityProjectList />;
}

// ── List view ───────────────────────────────────────────────────────────────

function CommunityProjectList() {
  const [projects, setProjects] = useState<ListedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.forumListProjects({ sort, q });
      setProjects(data.projects);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [sort]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/30">
              <Globe className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white">Community</h2>
              <p className="text-slate-400 text-sm">
                Cross-tenant project board — browse what others have shared, lend a hand.
              </p>
            </div>
          </div>
        </header>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }}
              placeholder="Filter by name, summary, climate zone, standard…"
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          </div>
          <button
            onClick={refresh}
            className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700/50"
          >Search</button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200"
          >
            <option value="recent">Most recent</option>
            <option value="oldest">Oldest first</option>
            <option value="comments">Most commented</option>
          </select>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700/50 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}

        {!err && projects.length === 0 && !loading && (
          <div className="glass-panel rounded-2xl border border-slate-800/60 p-10 text-center">
            <Globe className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No public projects yet.</p>
            <p className="text-slate-500 text-xs mt-1">
              From your Dashboard, click the share icon on a project to post it here.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/community/${p.id}`)}
              className="text-left glass-panel rounded-2xl border border-slate-800/60 p-5 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-white text-base flex-1">{p.name}</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400 flex-shrink-0">
                  {p.standard}
                </span>
              </div>
              <p className="text-sm text-slate-400 line-clamp-3 mb-3">{p.share_summary}</p>
              <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {p.org_name ?? 'Unknown org'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> {p.comment_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(p.shared_at).toLocaleDateString()}
                  </span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Detail view ─────────────────────────────────────────────────────────────

function CommunityProjectDetail({ id }: { id: string }) {
  const sessionUser = useAuthStore((s) => s.user);
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.forumGetProject(id);
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [id]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.forumAddComment(id, draft.trim());
      setDraft('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  const remove = async (commentId: string) => {
    if (!confirm('Delete your comment?')) return;
    try {
      await api.forumDeleteComment(commentId);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <Link to="/community" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-violet-400 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Community
        </Link>

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}

        {loading && !data && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}

        {data && (
          <>
            <header className="mb-6 glass-panel rounded-2xl border border-slate-800/60 p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <h1 className="text-2xl font-bold text-white">{data.project.name}</h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400 flex-shrink-0">
                  {data.project.standard}
                </span>
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap mb-4">{data.project.share_summary}</p>
              <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Shared by {data.project.org_name ?? 'Unknown org'}
                </span>
                {data.project.climate_zone && (
                  <span className="font-mono">Climate {data.project.climate_zone}</span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(data.project.shared_at).toLocaleDateString()}
                </span>
              </div>
            </header>

            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-violet-400" />
              Discussion ({data.comments.filter((c) => !c.deleted_at).length})
            </h2>

            <div className="space-y-3 mb-6">
              {data.comments.length === 0 ? (
                <p className="text-xs text-slate-500 italic px-3 py-4">
                  Be the first to weigh in.
                </p>
              ) : (
                data.comments.map((c) => {
                  const isMine = c.author_user_id === sessionUser?.id;
                  const author = [c.author_first_name, c.author_last_name].filter(Boolean).join(' ') || 'A user';
                  const authorAvatar = avatarUrl(c.author_user_id, c.author_avatar_key);
                  const authorInitials = [c.author_first_name?.[0], c.author_last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                  return (
                    <div key={c.id} className="glass-panel rounded-xl border border-slate-800/60 p-4">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full overflow-hidden bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 text-[10px] font-bold shrink-0 select-none">
                            {authorAvatar
                              ? <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
                              : authorInitials}
                          </div>
                          <div className="text-xs text-slate-400 min-w-0">
                            <span className="font-bold text-white">{author}</span>
                            {c.author_org_name && <span className="text-slate-500"> · {c.author_org_name}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 font-mono">
                            {new Date(c.created_at).toLocaleString()}
                          </span>
                          {isMine && !c.deleted_at && (
                            <button
                              onClick={() => remove(c.id)}
                              className="text-slate-500 hover:text-red-400"
                              title="Delete comment"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className={`text-sm whitespace-pre-wrap ${c.deleted_at ? 'text-slate-600 italic' : 'text-slate-300'}`}>
                        {c.body}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="glass-panel rounded-xl border border-slate-800/60 p-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add to the discussion — share what's worked for you, ask a clarifying question, suggest a check…"
                rows={3}
                className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y"
              />
              <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                <span className="text-[10px] text-slate-600">{draft.length} / 5000</span>
                <button
                  onClick={post}
                  disabled={posting || !draft.trim() || draft.length > 5000}
                  className="bg-violet-500/10 text-violet-400 border border-violet-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-violet-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> {posting ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
