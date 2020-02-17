// run this file using login credentials for Imagine Math:
//  > node index.js [username] [password] [start-index] [end-index]
//  username & password can also be stored in process env variables
//  default start-index = 0, default end-index = 1000

// library imports
const puppeteer = require("puppeteer");
const fs = require("fs");
const winston = require("winston");
// const express = require("express");

// const app = express();

// const PORT = process.env.PORT || 3000;

// constants
const IMAGINE_MATH_USERNAME =
  process.env.IMAGINE_MATH_USERNAME || process.argv[2];
const IMAGINE_MATH_PASSWORD =
  process.env.IMAGINE_MATH_PASSWORD || process.argv[3];
const FIRST_STUDENT_TO_CRAWL = process.argv[4] || 0; // 0 to start at beginning
const LAST_STUDENT_TO_CRAWL = process.argv[5] || 1000; // greater than max number of students to go through the end

let students = [];

// set up logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "user-service" },
  transports: [
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      timestamp: true
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      timestamp: true
    })
  ]
});

//if (process.env.NODE_ENV !== 'production') {
logger.add(
  new winston.transports.Console({
    format: winston.format.simple()
  })
);
//}

// start server
//app.listen(PORT, () => {
//  logger.info(`Our app is running on port ${PORT}`);
//});

// HELPER FUNCTIONS

// helper function for async delay
function delay(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

// helper function to traverse array asynchronously
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

// helper function to screenshot only one DOM element
async function screenshotDOMElement(page, selector, padding = 0, path) {
  const rect = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    const { x, y, width, height } = element.getBoundingClientRect();
    return { left: x, top: y, width, height, id: element.id };
  }, selector);

  return await page.screenshot({
    path: path,
    clip: {
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2
    }
  });
}

// class to store student information from Imagine Math crawl
class StudentInfo {
  constructor(
    first,
    last,
    grade,
    period,
    studentProgressLink,
    fullName = "",
    mostRecentCertificateUrl = "",
    studentAvatarSVGUrl = "",
    dateCrawled = ""
  ) {
    this.first = first;
    this.last = last;
    this.grade = grade;
    this.period = period;
    this.studentProgressLink = studentProgressLink;
    this.fullName = fullName;
    this.mostRecentCertificateUrl = mostRecentCertificateUrl;
    this.studentAvatarSVGUrl = studentAvatarSVGUrl;
    this.dateCrawled = dateCrawled;
  }
}

// main app function, asynchronously log on, crawl each students' profile page for most recent certificate & avatar

async function scrapeStudentProfiles() {
  logger.info("Async scrape started");

  if (IMAGINE_MATH_USERNAME == "" || IMAGINE_MATH_PASSWORD == "") {
    logger.error(
      "Must pass Imagine Math username & password as arguments:> node index.js [username] [password], or using process.env variables"
    );
    return;
  }

  // initialize puppeteer tools
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  logger.info("Browser started");

  // go to log in page
  await page.goto("https://math.imaginelearning.com/");

  // log in
  await page.type("#student_username", IMAGINE_MATH_USERNAME);
  await page.type("#student_password", IMAGINE_MATH_PASSWORD);
  await page.click("#btn_student_sign_in");
  await page.waitForNavigation();
  await page.screenshot({
    path: `test-screenshots/login-page.png`
  });

  // TO DO:
  // - grab last crawl date
  // - go to imagine math report for all passed lessons since previous crawl
  // - limit subset of students to only those who have passed a lesson since last crawl

  // fetch json data of all student profile pages:
  let rawStudentData = fs.readFileSync(
    "./student-profile-data/student-profile-links.json"
  );
  let studentData = JSON.parse(rawStudentData);
  await asyncForEach(studentData, async (item, index) => {
    // control the subset of data to crawl
    if (index < FIRST_STUDENT_TO_CRAWL - 1 || index > LAST_STUDENT_TO_CRAWL - 1)
      return;

    let student = new StudentInfo(
      item.First,
      item.Last,
      item.Grade,
      item["Math Period"],
      item["Student Progress Link"]
    );
    if (student.studentProgressLink.length == 0) return;

    try {
      // go to each student profile page
      await page.goto(student.studentProgressLink);
      await page.waitForSelector(".lessonActivity--certificate > a", {
        timeout: 20000
      });

      // select all the .lessonActivity--certificate spans that have an anchor tag (the lessons with certificates)
      let certificateLinks = await page.evaluate(() => {
        let links = [
          ...document.querySelectorAll(".lessonActivity--certificate > a")
        ];
        return links.map(link => link.href);
      });
      student.mostRecentCertificateUrl = certificateLinks.pop();

      // access certificate page with avatar
      await page.goto(student.mostRecentCertificateUrl);
      await page.waitForSelector(".name", { timeout: 10000 });
      student.fullName = await page.evaluate(() => {
        return document.querySelector(".name").innerHTML;
      });
      // save screenshot of most recent certificate (only the certificate selector)
      await screenshotDOMElement(
        page,
        ".frame",
        0,
        `crawled-certificates/${student.grade}-${student.last}-${student.first}-most-recent-certificate.png`
      );

      // get link to avatar SVG
      student.studentAvatarSVGUrl = await page.evaluate(() => {
        return (avatarImg = document.querySelector("div.avatar > img").src);
      });

      // download avatar SVG to a folder
      await page.goto(student.studentAvatarSVGUrl);
      let svgInline = await page.evaluate(
        () => document.querySelector("svg").outerHTML
      );
      fs.writeFile(
        `crawled-avatars/${student.grade}-${student.last}-${student.first}-avatar.svg`,
        svgInline,
        err => {
          if (err) {
            logger.error(err);
            return;
          }
          logger.info(
            `SVG successfully saved for ${student.fullName} (index: ${index})`
          );
        }
      );
    } catch (error) {
      await page.screenshot({
        path: `test-screenshots/Error-${student.grade}-${student.last}-${student.first}.png`
      });
      logger.error(
        `Error crawling student profile for ${student.first} ${student.last}: ` +
          error
      );
    }

    student.dateCrawled = Date(Date.now()).toString();

    students.push(student);
    logger.info(Object.values(student).join(","));

    // save new line to CSV file
    fs.appendFile(
      "logs/crawl-log.csv",
      Object.values(student).join(",") + ", \r\n",
      function(err) {
        if (err) {
          logger.error(err);
          return;
        }
      }
    );
    await delay(10000);

    // continue loop for all other students
  });

  await browser.close();
  logger.info("Browser closed");
};

// call the function to perform the scrape
scrapeStudentProfiles()
  .catch(error => {
       logger.error(error);
  })
  .finally(() => {
    //logger.info("Student data crawled: " + JSON.stringify(students));
    logger.info("End of crawl.");
    //browser.close();
    //logger.info("Browser closed");
  });
