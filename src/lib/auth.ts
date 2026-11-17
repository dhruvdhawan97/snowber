import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

// Better Auth: email/password sign-in with database sessions stored through Prisma.
// `role` is an extra column on the user table. People can sign up as a homeowner or
// a cleaner; controller accounts are only created by an existing controller
// (see createControllerAccount in src/lib/dal/users.ts).

export const auth = betterAuth({
  appName: "Snowber",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "HOMEOWNER", input: true },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // People removed by a controller can't sign in (their old sessions were deleted).
        before: async (session) => {
          const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { deactivatedAt: true } });
          if (user?.deactivatedAt) {
            throw new APIError("FORBIDDEN", { message: "This account has been removed. Contact the Snowber controller." });
          }
        },
      },
    },
    user: {
      create: {
        // Never trust the role sent at sign-up: only HOMEOWNER or CLEANER may be self-assigned.
        before: async (user) => {
          const requested = (user as { role?: unknown }).role;
          const role = requested === "CLEANER" ? "CLEANER" : "HOMEOWNER";
          return { data: { ...user, role } };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
