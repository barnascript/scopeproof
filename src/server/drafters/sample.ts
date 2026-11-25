import type { DraftPlan } from "../../shared/plan";
import type { DraftResult } from "./index";

export const SAMPLE_NAME = "Tutor booking app";

export const SAMPLE_BRIEF = `# Tutor booking app (first version)

Parents sign up and log in with email and password.
Parents search tutors by subject, level and area.
Each tutor has a profile page with photo, subjects, price per hour and reviews.
Parents book a 1-hour lesson in a free slot on the tutor's calendar.
Parents pay for the lesson by card when they book.
Tutors get an email when a lesson is booked or cancelled.
Parents can cancel up to 24 hours before the lesson and get a full refund.
After a lesson, parents leave a 1 to 5 star review.
Admins can hide a review that breaks the rules.
Pages should load fast on cheap Android phones.`;

// A draft in the shape a model sends back, with the mistakes I see most
// often from real models planted in it, so the demo works without an API key:
// a vague criterion, a dependency loop, a story with no criteria, a feature
// nobody asked for (with a made-up line number and a huge estimate), a
// repeated story, and two brief lines left out.
const PLAN: DraftPlan = {
  stories: [
    {
      key: "S1",
      title: "Parent sign up and log in",
      description: "Email and password accounts for parents.",
      acceptance: [
        "A parent can create an account with email and a password of at least 10 characters.",
        "A wrong password shows an error and does not sign the parent in.",
        "After 5 wrong passwords in 10 minutes the account waits 15 minutes.",
      ],
      estimate_hours: 8,
      depends_on: [],
      brief_lines: [3],
    },
    {
      key: "S2",
      title: "Search tutors",
      description: "Search by subject, level and area.",
      acceptance: ["Parents can filter by subject, level and area together.", "Search is fast and easy to use."],
      estimate_hours: 6,
      depends_on: [],
      brief_lines: [4],
    },
    {
      key: "S3",
      title: "Tutor profile page",
      description: "Photo, subjects, hourly price and reviews.",
      acceptance: ["The page shows photo, subjects, price per hour and the 10 newest reviews.", "A tutor with no reviews shows 'No reviews yet'."],
      estimate_hours: 5,
      depends_on: [],
      brief_lines: [5],
    },
    {
      key: "S4",
      title: "Book a lesson from the tutor calendar",
      description: "Pick a free 1-hour slot and hold it.",
      acceptance: ["Only free slots can be picked.", "Two parents cannot book the same slot; the second one sees it is taken."],
      estimate_hours: 14,
      depends_on: ["S1", "S5"],
      brief_lines: [6],
    },
    {
      key: "S5",
      title: "Card payment when booking",
      description: "Charge the card when the slot is booked.",
      acceptance: ["The lesson is only confirmed after the payment succeeds.", "A failed payment frees the slot within 1 minute."],
      estimate_hours: 12,
      depends_on: ["S4"],
      brief_lines: [7],
    },
    {
      key: "S6",
      title: "Email tutors about bookings and cancellations",
      description: "",
      acceptance: ["The tutor gets an email within 1 minute of a booking or a cancellation."],
      estimate_hours: 4,
      depends_on: ["S4"],
      brief_lines: [8],
    },
    {
      key: "S7",
      title: "Cancel a lesson with a full refund",
      description: "Up to 24 hours before the start.",
      acceptance: ["Cancelling 24 hours or more before the start refunds the full price.", "Inside 24 hours the cancel button is hidden."],
      estimate_hours: 6,
      depends_on: ["S5"],
      brief_lines: [9],
    },
    {
      key: "S8",
      title: "Star reviews after a lesson",
      description: "Parents rate the tutor from 1 to 5.",
      acceptance: [],
      estimate_hours: 5,
      depends_on: ["S4"],
      brief_lines: [10],
    },
    {
      key: "S9",
      title: "In-app chat between parents and tutors",
      description: "Real-time messages with read receipts.",
      acceptance: ["Messages arrive in real time.", "Parents see when the tutor has read a message."],
      estimate_hours: 60,
      depends_on: ["S1"],
      brief_lines: [14],
    },
    {
      key: "S10",
      title: "Tutor search",
      description: "Search page for tutors.",
      acceptance: ["Parents can search tutors by subject."],
      estimate_hours: 4,
      depends_on: [],
      brief_lines: [4],
    },
  ],
};

export function draftSample(): DraftResult {
  return { plan: structuredClone(PLAN), source: "sample", meta: { planted: 7 } };
}
