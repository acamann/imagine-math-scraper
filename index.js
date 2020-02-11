const puppeteer = require('puppeteer');

var scrapeStudentProfile = async (url) => {
    const browser = await puppeteer.launch({ });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800});

    // go to student profile page
    await page.goto(url);
    await page.screenshot({path: 'screenshots/01-first-access.png'});
    
    // log in
    await page.type('#student_username', process.argv[2]);
    await page.type('#student_password', process.argv[3]);
    await page.screenshot({path: 'screenshots/02-type-login-info.png'});
    await page.click('#btn_student_sign_in');
    await page.waitForSelector('.lessonActivity--certificate > a', { timeout: 5000 });
    await page.screenshot({path: 'screenshots/03-successful-login.png'});
    
    // access certificate with avatar
    await page.click('.lessonActivity--certificate > a');
    await page.screenshot({path: 'screenshots/04-clicked-certificate.png'});
        
    await browser.close();
};


scrapeStudentProfile('https://math.imaginelearning.com/student_progress/student/22211618')
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
