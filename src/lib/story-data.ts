import phone from "@/assets/cover-phone.jpg";
import nightbus from "@/assets/cover-nightbus.jpg";
import market from "@/assets/cover-market.jpg";
import traffic from "@/assets/cover-traffic.jpg";
import exam from "@/assets/cover-exam.jpg";
import type { Episode, Series } from "./story-rules";

export const SAMPLE_IMAGES = [
  { id: "phone", label: "Cracked phone", src: phone },
  { id: "nightbus", label: "Night bus", src: nightbus },
  { id: "market", label: "Market", src: market },
  { id: "traffic", label: "Lagos traffic", src: traffic },
  { id: "exam", label: "Campus", src: exam },
];

const AMARA =
  "Amara, 21, Mass Communication student at UNILAG, lives in Yaba, Lagos. Black braids, blue UNILAG hoodie, jeans, backpack. Curious, brave, a little stubborn.";

export const SAMPLE_SERIES: Series[] = [
  {
    id: "phone-tomorrow",
    title: "The Phone That Knew Tomorrow",
    genre: "Gen Z mystery",
    logline: "Amara finds a cracked phone in Yaba. One message on the screen is dated tomorrow.",
    characterDescription: AMARA,
    cover: phone,
  },
];

export const SAMPLE_EPISODES: Episode[] = [
  {
    id: "ep1",
    seriesId: "phone-tomorrow",
    number: 1,
    title: "Don't Take the 4pm Bus",
    summary: "Amara finds the cracked phone and reads a warning dated tomorrow.",
    characterDescription: AMARA,
    firstFrame: phone,
    status: "sample",
    updatedAt: 1,
    clips: [
      {
        id: "e1c1",
        durationSec: 8,
        prompt: "Amara walks through a busy Yaba street at golden hour, earphones in.",
      },
      {
        id: "e1c2",
        durationSec: 7,
        prompt: "She spots a cracked phone glowing on the pavement and picks it up.",
      },
      {
        id: "e1c3",
        durationSec: 8,
        prompt:
          'Close-up: the screen shows a message — "Don\'t take the 4pm bus" — dated tomorrow.',
      },
      {
        id: "e1c4",
        durationSec: 7,
        prompt: "Amara looks around, confused, as danfo buses roar past.",
      },
      {
        id: "e1c5",
        durationSec: 8,
        prompt: "She slips the phone into her backpack. The screen flickers: 23:59.",
      },
    ],
  },
  {
    id: "ep2",
    seriesId: "phone-tomorrow",
    number: 2,
    title: "Amara Decides",
    summary: "4:00pm. The bus is waiting and Amara has 30 seconds to choose.",
    characterDescription: AMARA,
    firstFrame: traffic,
    status: "sample",
    updatedAt: 2,
    clips: [
      {
        id: "e2c1",
        durationSec: 7,
        prompt: "Next day, 3:58pm. Amara stands at the bus stop, phone in hand.",
      },
      {
        id: "e2c2",
        durationSec: 8,
        prompt: 'The 4pm danfo pulls up. The conductor shouts "Oshodi! Oshodi!"',
      },
      {
        id: "e2c3",
        durationSec: 7,
        prompt: 'The cracked phone buzzes: "Last chance." Her hands shake.',
      },
      { id: "e2c4", durationSec: 7, prompt: "Amara steps back. The bus leaves without her." },
      {
        id: "e2c5",
        durationSec: 8,
        prompt: "Sirens in the distance. She stares at the phone — a new message appears.",
      },
    ],
  },
];
