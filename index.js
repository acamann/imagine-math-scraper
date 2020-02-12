// run this file using login credentials for Imagine Math:
//  > node index.js [username] [password]

const puppeteer = require('puppeteer');
const fs = require('fs');
let students = [];

function delay(timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

class StudentInfo {
    constructor (first, last, grade, period, studentProgressLink, fullName = "", mostRecentCertificateUrl = "", studentAvatarSVGUrl = "") {
        this.first = first;
        this.last = last;
        this.grade = grade;
        this.period = period;
        this.studentProgressLink = studentProgressLink;
        this.fullName = fullName;
        this.mostRecentCertificateUrl = mostRecentCertificateUrl;
        this.studentAvatarSVGUrl = studentAvatarSVGUrl;
    }
}

// JSON to CSV Converter
function ConvertToCSV(objArray) {
    var array = typeof objArray != 'object' ? JSON.parse(objArray) : objArray;
    var str = '';

    for (var i = 0; i < array.length; i++) {
        var line = '';
        for (var index in array[i]) {
            if (line != '') line += ','

            line += array[i][index];
        }

        str += line + '\r\n';
    }

    return str;
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

var scrapeStudentProfiles = async () => {
    const browser = await puppeteer.launch({ });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800});

    // go to log in page
    await page.goto('https://math.imaginelearning.com/');
    
    // log in
    await page.type('#student_username', process.argv[2]);
    await page.type('#student_password', process.argv[3]);
    await page.click('#btn_student_sign_in');
    await page.waitForNavigation();

    // fetch json data of all student profile pages:
    let rawStudentData = fs.readFileSync("./student-profile-data/student-profile-links.json");
    let studentData = JSON.parse(rawStudentData);
    await asyncForEach(studentData, async (item) => {
        let student = new StudentInfo(item.First, item.Last, item.Grade, item["Math Period"], item["Student Progress Link"]);
        if(student.studentProgressLink.length == 0) return;

        try {

            // go to each student profile page
            await page.goto(student.studentProgressLink);
            await page.waitForSelector('.lessonActivity--certificate > a', { timeout: 3000 });
            
            // select all the .lessonActivity--certificate spans that have an anchor tag (the lessons with certificates)
            let certificateLinks = await page.evaluate(() => {
                let links = [...document.querySelectorAll('.lessonActivity--certificate > a')];
                return links.map((link) => link.href);
            });
            student.mostRecentCertificateUrl = certificateLinks.pop();

            // access certificate page with avatar
            await page.goto(student.mostRecentCertificateUrl);
            await page.waitForSelector('.name', { timeout: 3000 });
            student.fullName = await page.evaluate(() => {
                return document.querySelector('.name').innerHTML;
            });
            // save screenshot of most recent certificate
            await page.screenshot({path: `crawled-images/${student.grade}-${student.last}-${student.first}-most-recent-certificate.png`});

            // get link to avatar SVG
            student.studentAvatarSVGUrl = await page.evaluate(() => {
                return avatarImg = document.querySelector('div.avatar > img').src;
            })
            
            // download avatar SVG to a folder
            await page.goto(student.studentAvatarSVGUrl);
            let svgInline = await page.evaluate(() => document.querySelector('svg').outerHTML);
            fs.writeFile(`crawled-images/${student.grade}-${student.last}-${student.first}-avatar.svg`, svgInline, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log(`SVG successfully saved for ${student.fullName}`);
            });

            

        } catch (error) {
            console.error(`Error crawling student profile for ${student.first} ${student.last}: ` + error);
        }

        // save all the links we crawled to a CSV row to be added to a CSV file once we are all done
        students.push(student);
        fs.appendFile('crawl-log.json', JSON.stringify(student) + ', \r\n', function (err) {
            if (err) {
                console.error(err);
                return;
            }
            console.log('Info logged to file: ' + JSON.stringify(student));
        });
        await delay(10000);

        // continue loop for all other students
    });
    
    // ** still need to implement CSV file creation

    // write csv file
    const jsonStudentInfo = JSON.stringify(students);
    const csvStudentInfo = ConvertToCSV(jsonStudentInfo);
    console.log(csvStudentInfo);

    await browser.close();
};


scrapeStudentProfiles()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
