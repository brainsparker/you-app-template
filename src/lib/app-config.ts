// Single place to rebrand a derived app. Every component reads from here.
export const appConfig = {
  // Used for UTM campaign tagging on sign-up CTAs. Keep it equal to the repo name.
  name: "you-app-template",
  title: "You.com App Template",
  tagline:
    "Starter template for You.com-powered apps that deploy to Webflow Cloud.",
  repoUrl: "https://github.com/brainsparker/you-app-template",
  docsUrl: "https://you.com/docs",
  platformUrl: "https://you.com/platform",
  // Let visitors run search and page extraction before they add a key, on
  // You.com's keyless free tier (100 queries per day, counted against this
  // deployment, not each visitor). Set to false when your app only makes
  // sense with a key, for example when it is built on the Research API.
  keylessTrial: true,
};
