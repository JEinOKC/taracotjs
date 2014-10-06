module.exports = function(app) {

    var router = app.get('express').Router(),
        gaikan = require('gaikan'),
        renderer = app.get('renderer'),
        path = app.get('path'),
        ObjectId = require('mongodb').ObjectID,
        crypto = require('crypto'),
        moment = require('moment'),
        fs = require('fs');

    var i18nm = new(require('i18n-2'))({
        locales: app.get('config').locales,
        directory: app.get('path').join(__dirname, 'lang'),
        extension: '.js'
    });

    router.get('/', function(req, res, next) {
        var _locale = req.i18n.getLocale();
        i18nm.setLocale(_locale);
        var mode = app.set('settings').social_mode || 'private',
            areas = app.set('settings').social_areas || '[]';
        if (!req.session.auth || req.session.auth.status < 1) {
            req.session.auth_redirect = '/social';
            res.redirect(303, "/auth?rnd=" + Math.random().toString().replace('.', ''));
            return;
        }
        var data = {
            title: i18nm.__('social'),
            page_title: i18nm.__('social'),
            keywords: '',
            description: '',
            extra_css: "\n\t" + '<link rel="stylesheet" href="/modules/social/css/frontend.css" type="text/css">'
        };
        var _regdate = i18nm.__('unknown_regdate');
        if (req.session.auth.regdate) _regdate = moment(req.session.auth.regdate).locale(_locale).fromNow();
        var current_user = {
            username: req.session.auth.username,
            realname: req.session.auth.realname,
            name: req.session.auth.realname || req.session.auth.username,
            avatar: req.session.auth.avatar,
            regdate: req.session.auth.regdate,
            regdate_text: _regdate,
            email: req.session.auth.email,
            id: req.session.auth._id
        };
        var render = renderer.render_file(path.join(__dirname, 'views'), 'social', {
            lang: i18nm,
            locale: _locale,
            data: data,
            current_user: JSON.stringify(current_user),
            _current_user: current_user
        }, req);
        data.content = render;
        return app.get('renderer').render(res, undefined, data, req);
    });

    router.post('/friends/search', function(req, res, next) {
        var _locale = req.i18n.getLocale();
        var rep = {
            status: 1,
            items_per_page: 30
        };
        i18nm.setLocale(_locale);
        if (!req.session.auth || req.session.auth.status < 1) {
            rep.status = 0;
            rep.error = i18nm.__("unauth");
            return res.send(JSON.stringify(rep));
        }
        var query = req.body.query,
            skip = req.body.skip;
        if (!query || !String(query).length || String(query).length < 3 || String(query).length > 100) {
            rep.status = 0;
            rep.error = i18nm.__("invalid_query");
            return res.send(JSON.stringify(rep));
        }
        if (skip) skip = parseInt(skip);
        if (skip && (typeof skip != 'number' || skip % 1 !== 0 || skip < 0)) {
            rep.status = 0;
            rep.error = i18nm.__("invalid_query");
            return res.send(JSON.stringify(rep));
        }
        if (!skip) skip = 0;
        skip = skip * rep.items_per_page;
        query = query.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '');
        var db_query = {
            $and: [{
                $or: [{
                    username: new RegExp(query, 'i')
                }, {
                    email: new RegExp(query, 'i')
                }, {
                    realname: new RegExp(query, 'i')
                }]
            }, {
                status: {
                    $ne: 0
                }
            }]
        };
        app.get('mongodb').collection('users').find(db_query).count(function(err, items_count) {
            if (err || !items_count) {
                rep.status = 0;
                rep.error = i18nm.__("no_items_found");
                return res.send(JSON.stringify(rep));
            }
            app.get('mongodb').collection('users').find(db_query, {
                skip: skip,
                limit: rep.items_per_page
            }).sort({
                username: 1
            }).toArray(function(err, items) {
                if (err || !items) {
                    rep.status = 0;
                    rep.error = i18nm.__("no_items_found");
                    return res.send(JSON.stringify(rep));
                }
                rep.items = items;
                for (var i = 0; i < rep.items.length; i++) {
                    if (rep.items[i].password) delete rep.items[i].password;
                    rep.items[i].avatar = "/images/avatars/default.png";
                    var afn = crypto.createHash('md5').update(app.get('config').salt + '.' + rep.items[i]._id.toHexString()).digest('hex');
                    if (fs.existsSync(path.join(__dirname, '..', '..', 'public', 'images', 'avatars', afn + '.jpg'))) rep.items[i].avatar = '/images/avatars/' + afn + '.jpg';
                }
                return res.send(JSON.stringify(rep));
            });
        });
    });

    router.post('/user/data', function(req, res, next) {
        var _locale = req.i18n.getLocale();
        var rep = {
            status: 1,
            items_per_page: 10
        };
        i18nm.setLocale(_locale);
        if (!req.session.auth || req.session.auth.status < 1) {
            rep.status = 0;
            rep.error = i18nm.__("unauth");
            return res.send(JSON.stringify(rep));
        }
        var user = req.body.user;
        if (!user.match(/^[A-Za-z0-9_\-]{3,20}$/)) {
            rep.status = 0;
            rep.error = i18nm.__("invalid_username");
            return res.send(JSON.stringify(rep));
        }
        var db_query = {
            username_auth: user
        };
        app.get('mongodb').collection('users').find(db_query, {
            limit: 1
        }).toArray(function(err, items) {
            if (err || !items) {
                rep.status = 0;
                rep.error = i18nm.__("user_not_found");
                return res.send(JSON.stringify(rep));
            }
            app.get('mongodb').collection('social_friends').find({
                $or: [{
                    $and: [{
                        u1: req.session.auth._id
                    }, {
                        u2: items[0]._id.toHexString()
                    }]
                }, {
                    $and: [{
                        u1: items[0]._id.toHexString()
                    }, {
                        u2: req.session.auth._id
                    }]
                }]
            }, {
                limit: 1
            }).toArray(function(err, sst) {
                var friendship = '0';
                if (sst && sst.length) {
                    if (sst[0].friends == '1') {
                        friendship = 1;
                    } else {
                        if (sst[0].u1 == req.session.auth._id) friendship = 2;
                        if (sst[0].u2 == req.session.auth._id) friendship = 3;
                    }
                }
                var user = items[0];
                if (user.password) delete user.password;
                if (user.email) delete user.email;
                user.avatar = "/images/avatars/default.png";
                var afn = crypto.createHash('md5').update(app.get('config').salt + '.' + user._id.toHexString()).digest('hex');
                if (fs.existsSync(path.join(__dirname, '..', '..', 'public', 'images', 'avatars', afn + '.jpg'))) user.avatar = '/images/avatars/' + afn + '.jpg';
                rep.user = user;
                rep.friendship = friendship;
                return res.send(JSON.stringify(rep));
            });
        });
    });

    router.post('/user/friendship/request', function(req, res, next) {
        var _locale = req.i18n.getLocale();
        var rep = {
            status: 1
        };
        i18nm.setLocale(_locale);
        if (!req.session.auth || req.session.auth.status < 1) {
            rep.status = 0;
            rep.error = i18nm.__("unauth");
            return res.send(JSON.stringify(rep));
        }
        var fid = req.body.id;
        if (!fid.match(/^[a-f0-9]{24}$/)) {
            rep.status = 0;
            rep.error = i18nm.__("invalid_user_id");
            return res.send(JSON.stringify(rep));
        }
        app.get('mongodb').collection('users').find({
            _id: new ObjectId(fid)
        }, {
            limit: 1
        }).toArray(function(err, items) {
            if (err || !items) {
                rep.status = 0;
                rep.error = i18nm.__("user_not_found");
                return res.send(JSON.stringify(rep));
            }
            if (items[0]._id.toHexString() == req.session.auth._id) {
                rep.status = 0;
                rep.error = i18nm.__("user_not_found");
                return res.send(JSON.stringify(rep));
            }
            app.get('mongodb').collection('social_friends').find({
                $or: [{
                    $and: [{
                        u1: req.session.auth._id
                    }, {
                        u2: items[0]._id.toHexString()
                    }, {
                        friends: ''
                    }]
                }, {
                    $and: [{
                        u1: items[0]._id.toHexString()
                    }, {
                        u2: req.session.auth._id
                    }, {
                        friends: ''
                    }]
                }]
            }, {
                limit: 1
            }).toArray(function(err, items) {
                if (err || (items && items.length)) {
                    rep.status = 0;
                    rep.error = i18nm.__("friendship_request_already_sent");
                    return res.send(JSON.stringify(rep));
                }
                app.get('mongodb').collection('social_friends').insert({
                    u1: req.session.auth._id,
                    u2: String(fid),
                    friends: ''
                }, function(err, items) {
                    if (err) {
                        rep.status = 0;
                        rep.error = i18nm.__("friendship_request_error");
                        return res.send(JSON.stringify(rep));
                    }
                    // Friendship request saved
                    return res.send(JSON.stringify(rep));
                });
            });
        });
    });

    router.post('/user/friendship/inv', function(req, res, next) {
        var _locale = req.i18n.getLocale();
        var rep = {
            status: 1,
            items_per_page: 10
        };
        i18nm.setLocale(_locale);
        if (!req.session.auth || req.session.auth.status < 1) {
            rep.status = 0;
            rep.error = i18nm.__("unauth");
            return res.send(JSON.stringify(rep));
        }
        var skip = req.body.skip;
        if (skip) skip = parseInt(skip);
        if (skip && (typeof skip != 'number' || skip % 1 !== 0 || skip < 0)) {
            rep.status = 0;
            rep.error = i18nm.__("invalid_query");
            return res.send(JSON.stringify(rep));
        }
        if (!skip) skip = 0;
        skip = skip * rep.items_per_page;
        var db_query = {
            $and: [{
                u2: req.session.auth._id
            }, {
                friends: ''
            }]
        };
        app.get('mongodb').collection('social_friends').find(db_query).count(function(err, items_count) {
            if (err || !items_count) {
                rep.status = 0;
                rep.error = i18nm.__("no_invitations_found");
                return res.send(JSON.stringify(rep));
            }
            app.get('mongodb').collection('social_friends').find(db_query, {
                skip: skip,
                limit: rep.items_per_page
            }).toArray(function(err, items) {
                if (err || !items || !items.length) {
                    rep.status = 0;
                    rep.error = i18nm.__("ajax_failed");
                    return res.send(JSON.stringify(rep));
                }
                var users = [];
                for (var i = 0; i < items.length; i++) {
                    users.push({
                        _id: new ObjectId(items[i].u1)
                    });
                }
                app.get('mongodb').collection('users').find({
                    $or: users
                }).sort({
                    username: 1
                }).toArray(function(err, items) {
                    if (err || !items || !items.length) {
                        rep.status = 0;
                        rep.error = i18nm.__("ajax_failed");
                        return res.send(JSON.stringify(rep));
                    }
                    rep.items = items;
                    for (var i = 0; i < rep.items.length; i++) {
                        if (rep.items[i].password) delete rep.items[i].password;
                        rep.items[i].avatar = "/images/avatars/default.png";
                        var afn = crypto.createHash('md5').update(app.get('config').salt + '.' + rep.items[i]._id.toHexString()).digest('hex');
                        if (fs.existsSync(path.join(__dirname, '..', '..', 'public', 'images', 'avatars', afn + '.jpg'))) rep.items[i].avatar = '/images/avatars/' + afn + '.jpg';
                    }
                    return res.send(JSON.stringify(rep));
                });
            });
        });
    });

    return router;
};