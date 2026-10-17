import { createTRPCRouter } from "../init";
import { authRouter } from "./auth";
import { coursesRouter } from "./courses";
import { enrolmentRouter } from "./enrolment";
import { friendsRouter } from "./friends";
import { peerDataRouter } from "./peer-data";
import { preferencesRouter } from "./preferences";
import { profileRouter } from "./profile";
import { savedTimetablesRouter } from "./saved-timetables";
import { timetableRouter } from "./timetable";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  courses: coursesRouter,
  enrolment: enrolmentRouter,
  profile: profileRouter,
  preferences: preferencesRouter,
  friends: friendsRouter,
  peerData: peerDataRouter,
  timetable: timetableRouter,
  savedTimetables: savedTimetablesRouter,
});

export type AppRouter = typeof appRouter;
