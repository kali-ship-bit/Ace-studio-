import phone from "@/assets/cover-phone.jpg";
import nightbus from "@/assets/cover-nightbus.jpg";
import market from "@/assets/cover-market.jpg";
import grandma from "@/assets/cover-grandma.jpg";
import exam from "@/assets/cover-exam.jpg";
import traffic from "@/assets/cover-traffic.jpg";
import comedy from "@/assets/cover-comedy.jpg";
import science from "@/assets/cover-science.jpg";
import music from "@/assets/cover-music.jpg";
import sports from "@/assets/cover-sports.jpg";
import food from "@/assets/cover-food.jpg";
import tech from "@/assets/cover-tech.jpg";

export const CATEGORIES = [
  "Stories",
  "Comedy",
  "Education",
  "Music",
  "Sports",
  "Food",
  "News",
  "Tech",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type FeedTab = "foryou" | "following" | "mine";

export const OWNER = "Kenneth / Ace Studio";

export interface Creator {
  name: string;
  initials: string;
  color: "bg-avatar-1" | "bg-avatar-2" | "bg-avatar-3" | "bg-avatar-4" | "bg-avatar-5";
  isOwner?: boolean;
}

export interface FeedVideo {
  id: string;
  title: string;
  series?: string;
  episode?: string;
  creator: Creator;
  category: Category;
  caption: string;
  hashtags: string[];
  sound: string;
  likes: number;
  comments: number;
  shares: number;
  durationSec: number;
  aiGenerated: boolean;
  cover: string;
}

const kenneth: Creator = { name: OWNER, initials: "KS", color: "bg-avatar-1", isOwner: true };
const c = (name: string, initials: string, color: Creator["color"]): Creator => ({
  name,
  initials,
  color,
});

export const FEED: FeedVideo[] = [
  {
    id: "v1",
    title: "Don't Take the 4pm Bus",
    series: "The Phone That Knew Tomorrow",
    episode: "Episode 1",
    creator: kenneth,
    category: "Stories",
    caption:
      "Amara, 21, Mass Comm student at UNILAG, finds a cracked phone in Yaba. One message on the screen is dated tomorrow…",
    hashtags: ["#ThePhoneThatKnewTomorrow", "#LagosStories", "#Episode1"],
    sound: "Original sound — Ace Studio",
    likes: 12400,
    comments: 842,
    shares: 1310,
    durationSec: 38,
    aiGenerated: true,
    cover: phone,
  },
  {
    id: "v2",
    title: "The Night Bus to Surulere",
    creator: c("Ada's Stories", "AS", "bg-avatar-2"),
    category: "Stories",
    caption: "The last bus of the night had one empty seat. Nobody wanted to sit there.",
    hashtags: ["#NightStories", "#Surulere"],
    sound: "Midnight Pads — Ada's Stories",
    likes: 8930,
    comments: 401,
    shares: 620,
    durationSec: 34,
    aiGenerated: true,
    cover: nightbus,
  },
  {
    id: "v3",
    title: "The Market Girl Who Found a Letter",
    creator: c("Lagos Tales", "LT", "bg-avatar-3"),
    category: "Stories",
    caption: "Hidden inside a basket of tomatoes: a letter addressed to her, written 20 years ago.",
    hashtags: ["#LagosTales", "#Mystery"],
    sound: "Golden Hour — Lagos Tales",
    likes: 15200,
    comments: 1120,
    shares: 2040,
    durationSec: 36,
    aiGenerated: true,
    cover: market,
  },
  {
    id: "v4",
    title: "My Grandma's Last Recipe",
    creator: c("Boomer Tales", "BT", "bg-avatar-4"),
    category: "Stories",
    caption: "She never wrote it down. So I tried to remember every step.",
    hashtags: ["#Family", "#Memories"],
    sound: "Soft Keys — Boomer Tales",
    likes: 21300,
    comments: 1880,
    shares: 3100,
    durationSec: 40,
    aiGenerated: true,
    cover: grandma,
  },
  {
    id: "v5",
    title: "The Danfo Driver's Secret",
    creator: c("Street Stories NG", "SS", "bg-avatar-5"),
    category: "Stories",
    caption: "Every morning he stops at the same corner. Today we found out why.",
    hashtags: ["#Danfo", "#StreetStories"],
    sound: "City Drums — Street Stories NG",
    likes: 9870,
    comments: 655,
    shares: 870,
    durationSec: 33,
    aiGenerated: true,
    cover: traffic,
  },
  {
    id: "v6",
    title: "Exam Day Miracle",
    creator: c("Campus Life", "CL", "bg-avatar-2"),
    category: "Stories",
    caption: "She studied the wrong chapter. Then the invigilator walked in…",
    hashtags: ["#CampusLife", "#ExamSeason"],
    sound: "Hopeful — Campus Life",
    likes: 7420,
    comments: 390,
    shares: 510,
    durationSec: 35,
    aiGenerated: true,
    cover: exam,
  },
  {
    id: "v7",
    title: "The Rainy Day in Yaba",
    creator: c("Yaba Diaries", "YD", "bg-avatar-3"),
    category: "Stories",
    caption: "Two strangers, one umbrella, and a power cut at the worst moment.",
    hashtags: ["#YabaDiaries", "#RainyDay"],
    sound: "Rain Loop — Yaba Diaries",
    likes: 6310,
    comments: 288,
    shares: 402,
    durationSec: 31,
    aiGenerated: true,
    // A rainy street scene, not the night-bus cover v2 already uses.
    cover: traffic,
  },
  {
    id: "v8",
    title: "Amara Decides",
    series: "The Phone That Knew Tomorrow",
    episode: "Episode 2",
    creator: kenneth,
    category: "Stories",
    caption: "4:00pm. The bus is waiting. Amara has 30 seconds to choose.",
    hashtags: ["#ThePhoneThatKnewTomorrow", "#Episode2"],
    sound: "Original sound — Ace Studio",
    likes: 9800,
    comments: 712,
    shares: 980,
    durationSec: 37,
    aiGenerated: true,
    cover: phone,
  },
  {
    id: "v9",
    title: "When Your Alarm Betrays You",
    creator: c("Laugh Lagos", "LL", "bg-avatar-4"),
    category: "Comedy",
    caption: "Set 6 alarms. Woke up at 11. Make it make sense 😭",
    hashtags: ["#Relatable", "#Comedy"],
    sound: "Funny Bones — Laugh Lagos",
    likes: 33100,
    comments: 2410,
    shares: 5200,
    durationSec: 30,
    aiGenerated: false,
    cover: comedy,
  },
  {
    id: "v10",
    title: "How Rainbows Actually Form in 30 Seconds",
    creator: c("Quick Science", "QS", "bg-avatar-5"),
    category: "Education",
    caption: "Sunlight + raindrops + the right angle = magic (and physics).",
    hashtags: ["#LearnOnAceStudio", "#Science"],
    sound: "Curious Mind — Quick Science",
    likes: 11800,
    comments: 520,
    shares: 1900,
    durationSec: 30,
    aiGenerated: false,
    cover: science,
  },
  {
    id: "v11",
    title: "Sunday Afrobeat Vibes Mix",
    creator: c("Night Drive Sounds", "ND", "bg-avatar-1"),
    category: "Music",
    caption: "Windows down, volume up. Your Sunday soundtrack.",
    hashtags: ["#SundayVibes", "#Afrobeat"],
    sound: "Sunday Mix — Night Drive Sounds",
    likes: 18700,
    comments: 960,
    shares: 2300,
    durationSec: 40,
    aiGenerated: false,
    cover: music,
  },
  {
    id: "v12",
    title: "The Perfect Free Kick Explained",
    creator: c("Pitch Talk", "PT", "bg-avatar-4"),
    category: "Sports",
    caption: "Plant foot, hip angle, follow-through. Here's the secret.",
    hashtags: ["#Football", "#Skills"],
    sound: "Stadium Hype — Pitch Talk",
    likes: 14200,
    comments: 830,
    shares: 1500,
    durationSec: 34,
    aiGenerated: false,
    cover: sports,
  },
  {
    id: "v13",
    title: "Jollof Rice in 5 Easy Steps",
    creator: c("Kitchen Naija", "KN", "bg-avatar-3"),
    category: "Food",
    caption: "Smoky party jollof at home. Step 4 is the game changer.",
    hashtags: ["#Jollof", "#KitchenNaija"],
    sound: "Kitchen Groove — Kitchen Naija",
    likes: 27600,
    comments: 3120,
    shares: 4100,
    durationSec: 39,
    aiGenerated: false,
    cover: food,
  },
  {
    id: "v14",
    title: "Demo Daily Update: City Traffic Tips",
    creator: c("Demo News Desk", "DN", "bg-avatar-5"),
    category: "News",
    caption: "Fictional demo update — 3 tips for beating rush hour. Not real news.",
    hashtags: ["#DemoNews", "#Traffic"],
    sound: "News Bed — Demo News Desk",
    likes: 4300,
    comments: 210,
    shares: 380,
    durationSec: 32,
    aiGenerated: true,
    cover: traffic,
  },
  {
    id: "v15",
    title: "3 Phone Settings You Should Change Today",
    creator: c("Tech Simplified", "TS", "bg-avatar-2"),
    category: "Tech",
    caption: "Battery, privacy and storage — fixed in under a minute.",
    hashtags: ["#TechTips", "#PhoneHacks"],
    sound: "Clean Beat — Tech Simplified",
    likes: 16900,
    comments: 740,
    shares: 2800,
    durationSec: 33,
    aiGenerated: false,
    cover: tech,
  },
];

export function filterFeed(
  videos: FeedVideo[],
  tab: FeedTab,
  category: Category | null,
  followed?: ReadonlySet<string>,
): FeedVideo[] {
  return videos.filter((v) => {
    if (tab === "mine" && !v.creator.isOwner) return false;
    if (tab === "following") {
      // With a followed set, show exactly the creators the user follows; without
      // one (e.g. unit tests / demo default), keep the old non-owner behaviour.
      if (followed !== undefined) {
        if (!followed.has(v.creator.name)) return false;
      } else if (v.creator.isOwner) return false;
    }
    if (category && v.category !== category) return false;
    return true;
  });
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const SAMPLE_COMMENTS = [
  {
    name: "Tolu B.",
    initials: "TB",
    color: "bg-avatar-2" as const,
    text: "I need episode 3 right now 😩",
    likes: 214,
  },
  {
    name: "Chidi O.",
    initials: "CO",
    color: "bg-avatar-4" as const,
    text: "The cover art alone 🔥🔥",
    likes: 98,
  },
  {
    name: "Ife A.",
    initials: "IA",
    color: "bg-avatar-3" as const,
    text: "This reminds me of my own Yaba days",
    likes: 57,
  },
  {
    name: "Musa K.",
    initials: "MK",
    color: "bg-avatar-5" as const,
    text: "Who else watched this 3 times?",
    likes: 31,
  },
];

export const SAMPLE_NOTIFICATIONS = [
  { id: "n1", text: "Ada's Stories started following you", time: "2m ago" },
  { id: "n2", text: 'Your video "Don\'t Take the 4pm Bus" reached 12K likes', time: "1h ago" },
];
