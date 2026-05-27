import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { Logger } from "../utils/logger.js";

const logger = new Logger("UPLOADER");

export class ChannelsUploader {
  /**
   * Upload video to WeChat Channels assistant and save as draft.
   * @param {string} videoPath Path to final MP4 video
   * @param {Object} videoMetadata Metadata like title, description, tags, collection_name, publish_mode
   * @param {Object} systemConfig Configuration parameters (selectors, timeouts)
   */
  async upload(videoPath, videoMetadata, systemConfig) {
    const absoluteVideoPath = path.resolve(videoPath);
    if (!fs.existsSync(absoluteVideoPath)) {
      throw new Error(`Video file not found for upload: ${absoluteVideoPath}`);
    }

    logger.info(`Starting WeChat Channels upload automation...`);

    // Read parameters from config to prevent magic values
    const headless = systemConfig.PLAYWRIGHT_HEADLESS !== undefined ? systemConfig.PLAYWRIGHT_HEADLESS : false;
    const slowMo = systemConfig.PLAYWRIGHT_SLOW_MO_MS || 1000;
    const timeout = systemConfig.PLAYWRIGHT_DEFAULT_TIMEOUT_MS || 60000;
    const userDataDir = path.resolve(systemConfig.PLAYWRIGHT_USER_DATA_DIR || "./.chrome_session");

    // Ensure user data directory exists for persistent context
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    // Launch persistent context — auto-saves cookies, localStorage, IndexedDB
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      slowMo,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled']
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    try {
      // 1. Navigate to Channels Creator Home
      logger.info(`Navigating to WeChat Channels Creator Home: ${systemConfig.CHANNELS_HOME_URL}`);
      await page.goto(systemConfig.CHANNELS_HOME_URL);

      // 2. Check login status via URL detection (redirect-based, more reliable than DOM selectors)
      let isLoggedIn = false;
      try {
        await page.waitForURL(/.*login.*/, { timeout: 10000 });
        // URL contains /login → session expired
        logger.warn(`Session expired or not logged in. Waiting for manual scan...`);
      } catch {
        // No redirect to /login → already authenticated
        isLoggedIn = true;
        logger.info(`Login session verified successfully.`);
      }

      // If not logged in, prompt user and wait for QR Code Scan
      if (!isLoggedIn) {
        logger.info("==================================================================");
        logger.info("  [ACTION REQUIRED] PLEASE SCAN THE QR CODE ON THE BROWSER WINDOW  ");
        logger.info("==================================================================");

        // Wait for user to scan and redirect back to post/create page
        const loginWaitTimeout = 180000;
        await page.waitForURL(systemConfig.CHANNELS_HOME_URL, { timeout: loginWaitTimeout });
        logger.info(`Login successful. Session automatically persisted for future runs.`);
      }

      // 3. Locate File Input and Upload Video
      logger.info(`Uploading video file: ${absoluteVideoPath}`);
      const fileInputSelector = systemConfig.CHANNELS_UPLOAD_INPUT_SELECTOR || 'input[type="file"]';
      await page.waitForSelector(fileInputSelector, { state: 'attached', timeout: 30000 });
      await page.setInputFiles(fileInputSelector, absoluteVideoPath);
      logger.info(`Video upload triggered. Waiting for processing...`);

      // 4. Fill description/title via the rich editor (video号 uses a single contenteditable/textarea)
      const title = videoMetadata.title || "技术科普视频";
      const tags = videoMetadata.tags || [];
      const description = videoMetadata.description || "";

      // Assemble description with hashtags (follows video-bot's approach)
      const hashTags = tags.map(tag => `#${tag}`).join(' ');
      const fullDescription = description
        ? `${title}\n\n${description}\n\n${hashTags}`
        : `${title}\n\n${hashTags}`;

      logger.info(`Filling video description...`);
      const descSelector = '.input-editor, textarea, [contenteditable="true"]';
      await page.waitForSelector(descSelector, { timeout: 30000 });
      await page.focus(descSelector);
      await page.keyboard.type(fullDescription);
      await page.waitForTimeout(1000);

      // 5. Collection/Archive (optional)
      const collectionName = videoMetadata.collection_name;
      if (collectionName) {
        try {
          logger.info(`Attempting to archive to collection: [${collectionName}]...`);
          const collectionDropdownSelector = 'text="添加到合集", .collection-select-trigger';
          const collectionBtn = page.locator(collectionDropdownSelector);
          if (await collectionBtn.isVisible()) {
            await collectionBtn.click();
            await page.waitForTimeout(1000);
            await page.keyboard.type(collectionName);
            await page.waitForTimeout(1000);
            await page.click(`text="${collectionName}"`);
          }
        } catch (colErr) {
          logger.warn(`Archiving to collection [${collectionName}] failed, skipping: ${colErr.message}`);
        }
      }

      // 6. Wait for Upload Completion (wait until the button is no longer disabled)
      logger.info("Waiting for video upload to finish processing (button to become enabled)...");
      const draftBtn = page.locator(systemConfig.CHANNELS_SAVE_DRAFT_BUTTON_SELECTOR).first();
      await draftBtn.waitFor({ state: "visible", timeout: 180000 });
      
      // Wait until the button is fully active and not disabled
      await page.waitForFunction((el) => {
        return el && !el.disabled && !el.hasAttribute('disabled') && !el.classList.contains('is-disabled');
      }, await draftBtn.elementHandle(), { timeout: 180000 });
      
      logger.info("Video upload completed and save button is now active.");

      // 7. Save as Draft or Publish (default: draft)
      const publishMode = videoMetadata.publish_mode || 'draft';

      if (publishMode === 'draft') {
        logger.info(`Saving draft...`);
        await draftBtn.click();
        await page.waitForTimeout(5000);
        logger.info("Draft saved successfully to WeChat Channels.");
      } else {
        logger.info(`Publishing directly...`);
        await page.click('button:has-text("发表"), text="发表"');
        await page.waitForTimeout(5000);
        logger.info("Video published successfully.");
      }

    } catch (err) {
      logger.error("WeChat Channels upload automation failed", err.stack);
      throw err;
    } finally {
      logger.info("Closing browser context.");
      await context.close();
    }
  }
}
