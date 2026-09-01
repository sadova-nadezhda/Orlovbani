import fileinclude from "gulp-file-include";
// import webpHtmlNosvg from "gulp-webp-html-nosvg" //libs for formating img to webp
import versionNumber from "gulp-version-number";

// Получаем пути и копируем пути
export const html = () => {
    return app.gulp.src(app.path.src.html)
        .pipe(app.plugins.plumber(
            app.plugins.notify.onError({
                title: "HTML",
                message: "Error: <%= error.message %>"
            })
        ))
        .pipe(fileinclude())
        .pipe(app.plugins.replace(/@img\//g, 'img/'))
        // .pipe(webpHtmlNosvg()) //autoformat WEBP IMG uncomment if need;
        .pipe(versionNumber({
            'value': '%DT%',
            'append': {
                'key': '_v',
                'cover': 0,
                'to': [
                    'css',
                    'js',
                ]
            },
            'output': {
                'file': 'gulp/version.json',
            }
        }))
        .pipe(app.gulp.dest(app.path.build.html))
        .pipe(app.plugins.browsersync.stream());
}